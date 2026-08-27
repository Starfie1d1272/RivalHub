"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLogs, educationVerifications, institutionEmailDomains, institutions, users } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";
import { emailDomain, educationSubmissionSchema, normalizeChsiEvidenceUrl } from "@/lib/education/validation";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";
import { z } from "zod";

function refresh(): void {
  revalidatePath("/settings/education");
  revalidatePath("/admin/education-verifications");
}

export async function submitEducationVerification(input: unknown): Promise<ActionResult<void>> {
  const parsed = educationSubmissionSchema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写学校、身份和有效的学信网在线验证链接。" });
  const evidenceUrl = normalizeChsiEvidenceUrl(parsed.data.evidenceUrl);
  if (!evidenceUrl) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "仅支持 https://www.chsi.com.cn 或 https://chsi.com.cn 的官方在线验证链接。" });
  try {
    const session = await requireAuth();
    const institution = await db.query.institutions.findFirst({ where: eq(institutions.id, parsed.data.institutionId) });
    if (!institution) throw new AppError(ErrorCode.NOT_FOUND, "所选高校不存在，请刷新后重试。");
    await db.transaction(async (tx) => {
      const [verification] = await tx.insert(educationVerifications).values({
        userId: session.userId,
        institutionId: institution.id,
        academicStatus: parsed.data.academicStatus,
        evidenceType: parsed.data.evidenceType,
        evidenceUrl,
      }).returning({ id: educationVerifications.id });
      await tx.insert(auditLogs).values({
        action: "education_verification.submit", actorId: auditActorId(session), targetId: verification?.id,
        targetType: "education_verification", meta: { institutionId: institution.id, evidenceType: parsed.data.evidenceType },
      });
    });
    refresh();
    return ok(undefined);
  } catch (error) { return actionError("submitEducationVerification", error); }
}

/** Convert a verified exact-domain credential into an approved immutable claim. */
export async function declareInstitutionalEmailEducation(input: { academicStatus: "enrolled" | "graduated" }): Promise<ActionResult<void>> {
  const parsed = z.object({ academicStatus: z.enum(["enrolled", "graduated"]) }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择在读或已毕业。" });
  try {
    const session = await requireAuth();
    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user?.emailVerifiedAt) throw new AppError(ErrorCode.FORBIDDEN, "请先验证当前账号邮箱。 ");
    const domain = emailDomain(user.email);
    if (!domain) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前账号邮箱无效。 ");
    const [mapping] = await db.select({ institutionId: institutionEmailDomains.institutionId })
      .from(institutionEmailDomains)
      .where(and(eq(institutionEmailDomains.domain, domain), eq(institutionEmailDomains.autoVerify, true), eq(institutionEmailDomains.active, true)))
      .limit(1);
    if (!mapping) throw new AppError(ErrorCode.FORBIDDEN, "当前账号邮箱不支持学校邮箱自动认证。 ");
    await db.transaction(async (tx) => {
      const existing = await tx.query.educationVerifications.findFirst({
        where: and(eq(educationVerifications.userId, session.userId), eq(educationVerifications.institutionId, mapping.institutionId), eq(educationVerifications.evidenceType, "institutional_email"), eq(educationVerifications.academicStatus, parsed.data.academicStatus), eq(educationVerifications.status, "approved")),
      });
      if (existing) return;
      const [verification] = await tx.insert(educationVerifications).values({
        userId: session.userId, institutionId: mapping.institutionId, academicStatus: parsed.data.academicStatus,
        evidenceType: "institutional_email", status: "approved", reviewedBy: "system:institutional_email", reviewedAt: new Date(),
      }).returning({ id: educationVerifications.id });
      await tx.insert(auditLogs).values({ action: "education_verification.institutional_email", actorId: auditActorId(session), targetId: verification?.id, targetType: "education_verification", meta: { institutionId: mapping.institutionId } });
    });
    refresh();
    return ok(undefined);
  } catch (error) { return actionError("declareInstitutionalEmailEducation", error); }
}

export async function reviewEducationVerification(input: { id: string; decision: "approved" | "rejected"; reviewNote?: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reviewNote: z.string().trim().max(1000).optional() }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "审核输入无效。" });
  try {
    // Education evidence is global sensitive identity data.  A season-scoped
    // administrator must not obtain cross-season CHSI access merely by having
    // ordinary admin navigation.
    const admin = await requireSuperAdmin();
    await db.transaction(async (tx) => {
      const verification = await tx.query.educationVerifications.findFirst({ where: eq(educationVerifications.id, parsed.data.id) });
      if (!verification) throw new AppError(ErrorCode.NOT_FOUND, "教育认证记录不存在。 ");
      if (verification.status !== "pending") throw new AppError(ErrorCode.VALIDATION_FAILED, "该认证已经处理，不能重复审核。 ");
      await tx.update(educationVerifications).set({ status: parsed.data.decision, reviewedBy: auditActorId(admin), reviewedAt: new Date(), reviewNote: parsed.data.reviewNote || null, updatedAt: new Date() }).where(eq(educationVerifications.id, verification.id));
      await tx.insert(auditLogs).values({ action: `education_verification.${parsed.data.decision}`, actorId: auditActorId(admin), targetId: verification.id, targetType: "education_verification", meta: { reviewNote: Boolean(parsed.data.reviewNote) } });
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
