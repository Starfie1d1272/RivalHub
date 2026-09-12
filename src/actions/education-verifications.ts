"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { educationVerifications, institutionEmailDomains, institutions, userIdentities } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";
import {
  submitAdmissionNoticeEducationCommand,
  submitChsiEducationVerification,
  type EducationSubmissionOutcome,
} from "@/lib/education/commands";
import {
  emailDomain,
  educationSubmissionSchema,
  normalizeChsiEvidenceCode,
  validateEducationEvidenceFile,
} from "@/lib/education/validation";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";
import { z } from "zod";

function refresh(): void {
  revalidatePath("/settings/education");
  revalidatePath("/admin/education-verifications");
}

export type { EducationSubmissionOutcome } from "@/lib/education/commands";

export async function submitEducationVerification(input: unknown): Promise<ActionResult<EducationSubmissionOutcome>> {
  const parsed = educationSubmissionSchema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写学校、身份和有效的学信网在线验证码。" });
  const evidenceCode = normalizeChsiEvidenceCode(parsed.data.evidenceCode);
  if (!evidenceCode) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入报告中的在线验证码（通常为 16 位）。" });
  try {
    const session = await requireAuth();
    const outcome = await submitChsiEducationVerification({ ...parsed.data, evidenceCode, session });
    refresh();
    return ok(outcome);
  } catch (error) { return actionError("submitEducationVerification", error); }
}

export async function submitAdmissionNoticeEducation(formData: FormData): Promise<ActionResult<EducationSubmissionOutcome>> {
  if (!(formData instanceof FormData)) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请提交录取通知书图片。" });
  const keys = [...new Set(formData.keys())];
  const institutionValues = formData.getAll("institutionId");
  const fileValues = formData.getAll("file");
  if (keys.some((key) => key !== "institutionId" && key !== "file") || institutionValues.length !== 1 || fileValues.length !== 1) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择一所高校并上传一张录取通知书图片。" });
  }
  const institutionId = institutionValues[0];
  if (typeof institutionId !== "string") return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择高校。" });
  const parsed = z.object({ institutionId: z.uuid() }).strict().safeParse({ institutionId });
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择目录中的高校。" });

  try {
    const session = await requireAuth();
    const file = await validateEducationEvidenceFile(fileValues[0]);
    const outcome = await submitAdmissionNoticeEducationCommand({ session, institutionId: parsed.data.institutionId, file });
    refresh();
    return ok(outcome);
  } catch (error) { return actionError("submitAdmissionNoticeEducation", error); }
}

/** Convert a selected verified exact-domain credential into an approved immutable claim. */
export async function declareInstitutionalEmailEducation(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ identityId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择已验证的学生邮箱。" });
  try {
    const session = await requireAuth();
    const [identity] = await db.select({ email: userIdentities.normalizedValue })
      .from(userIdentities)
      .where(and(
        eq(userIdentities.id, parsed.data.identityId),
        eq(userIdentities.userId, session.userId),
        eq(userIdentities.kind, "email"),
        eq(userIdentities.status, "active"),
        sql`${userIdentities.verifiedAt} IS NOT NULL`,
      ))
      .limit(1);
    if (!identity?.email) throw new AppError(ErrorCode.FORBIDDEN, "请选择属于当前账号的 verified email identity。");
    const domain = emailDomain(identity.email);
    if (!domain) throw new AppError(ErrorCode.VALIDATION_FAILED, "所选 verified email identity 无效。");
    const [mapping] = await db.select({ institutionId: institutionEmailDomains.institutionId })
      .from(institutionEmailDomains)
      .where(and(
        eq(institutionEmailDomains.domain, domain),
        eq(institutionEmailDomains.autoVerify, true),
        eq(institutionEmailDomains.active, true),
        eq(institutionEmailDomains.credentialType, "student"),
      ))
      .limit(1);
    if (!mapping) throw new AppError(ErrorCode.FORBIDDEN, "所选 verified email identity 不支持学校邮箱自动认证。");
    await db.transaction(async (tx) => {
      const existing = await tx.query.educationVerifications.findFirst({
        where: and(eq(educationVerifications.userId, session.userId), eq(educationVerifications.institutionId, mapping.institutionId), eq(educationVerifications.evidenceType, "institutional_email"), eq(educationVerifications.academicStatus, "enrolled"), eq(educationVerifications.status, "approved")),
      });
      if (existing) return;
      const [verification] = await tx.insert(educationVerifications).values({
        userId: session.userId, institutionId: mapping.institutionId, academicStatus: "enrolled",
        evidenceType: "institutional_email", status: "approved", reviewedBy: "system:institutional_email", reviewedAt: new Date(),
      }).returning({ id: educationVerifications.id });
      await writeAuditInTx(tx, { action: "education_verification.institutional_email", actorId: auditActorId(session), targetId: verification?.id,meta: { institutionId: mapping.institutionId } });
    });
    refresh();
    return ok(undefined);
  } catch (error) { return actionError("declareInstitutionalEmailEducation", error); }
}

export async function reviewEducationVerification(input: { id: string; decision: "approved" | "rejected"; reviewNote?: string }): Promise<ActionResult<void>> {
  const reviewSchema = z.object({ id: z.guid(), decision: z.enum(["approved", "rejected"]), reviewNote: z.string().trim().max(1000).optional() }).superRefine((value, ctx) => {
    if (value.decision === "rejected" && !value.reviewNote) {
      ctx.addIssue({ code: "custom", path: ["reviewNote"], message: "驳回原因不能为空。" });
    }
  });
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.find((issue) => issue.message === "驳回原因不能为空。");
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: reasonIssue?.message ?? "审核输入无效。" });
  }
  try {
    // Education evidence is global sensitive identity data.  A season-scoped
    // administrator must not obtain cross-season CHSI access merely by having
    // ordinary admin navigation.
    const admin = await requireSuperAdmin();
    await db.transaction(async (tx) => {
      const verification = await tx.query.educationVerifications.findFirst({ where: eq(educationVerifications.id, parsed.data.id) });
      if (!verification) throw new AppError(ErrorCode.NOT_FOUND, "教育认证记录不存在。 ");
      if (verification.status !== "pending") throw new AppError(ErrorCode.VALIDATION_FAILED, "该认证已经处理，不能重复审核。 ");
      if (parsed.data.decision === "approved" && verification.evidenceType === "manual_other" && !verification.evidenceObjectKey) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "录取通知书材料已按保留策略清理，无法通过该认证。 ");
      }
      await tx.update(educationVerifications).set({ status: parsed.data.decision, reviewedBy: auditActorId(admin), reviewedAt: new Date(), reviewNote: parsed.data.reviewNote || null, updatedAt: new Date() }).where(eq(educationVerifications.id, verification.id));
      await writeAuditInTx(tx, { action: `education_verification.${parsed.data.decision}`, actorId: auditActorId(admin), targetId: verification.id,meta: { reviewNote: Boolean(parsed.data.reviewNote) } });
    });
    refresh();
    return ok(undefined);
  } catch (error) { return actionError("reviewEducationVerification", error); }
}

export async function getInstitutionSearch(query: string): Promise<ActionResult<Array<{ id: string; name: string; code: string | null; province: string | null }>>> {
  try {
    await requireAuth();
    const q = query.trim();
    const results = await db.query.institutions.findMany({
      where: q ? (table, { ilike }) => ilike(table.name, `%${q}%`) : undefined,
      columns: { id: true, name: true, moeInstitutionCode: true, province: true }, orderBy: [institutions.name], limit: 20,
    });
    return ok(results.map((row) => ({ id: row.id, name: row.name, code: row.moeInstitutionCode, province: row.province })));
  } catch (error) { return actionError("getInstitutionSearch", error); }
}
