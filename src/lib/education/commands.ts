import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { db } from "@/db/client";
import { auditLogs, educationVerifications, institutions, userIdentities, users } from "@/db/schema";
import { auditActorId, type UserSession } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { logEvent } from "@/lib/observability/server";
import { educationEvidenceStorage } from "./storage";
import type { ValidatedEducationEvidenceFile } from "./validation";

export type EducationSubmissionOutcome = "created" | "already_pending" | "already_approved";

export interface EducationSubmissionContext {
  userId: string;
  institutionId: string;
}

/**
 * Shared trusted boundary for CHSI and manual submissions. The session has
 * already been canonicalized by requireAuth/getUserSession; this query still
 * verifies the active user, a durable verified email ownership fact, and the
 * canonical institution before either path can write.
 */
export async function requireEducationSubmissionContext(
  session: UserSession,
  institutionId: string,
): Promise<EducationSubmissionContext> {
  const [user, verifiedIdentity] = await Promise.all([
    db.query.users.findFirst({
      where: and(eq(users.id, session.userId), eq(users.status, "active")),
      columns: { id: true, emailVerifiedAt: true },
    }),
    db.select({ id: userIdentities.id })
      .from(userIdentities)
      .where(and(
        eq(userIdentities.userId, session.userId),
        eq(userIdentities.kind, "email"),
        eq(userIdentities.status, "active"),
        sql`${userIdentities.verifiedAt} IS NOT NULL`,
      ))
      .limit(1),
  ]);

  if (!user || (!user.emailVerifiedAt && !verifiedIdentity[0])) {
    throw new AppError(ErrorCode.FORBIDDEN, "请先验证当前账号邮箱，验证后才能提交教育身份认证。 ");
  }

  const institution = await db.query.institutions.findFirst({
    where: eq(institutions.id, institutionId),
    columns: { id: true },
  });
  if (!institution) throw new AppError(ErrorCode.NOT_FOUND, "所选高校不存在，请刷新后重试。");

  return { userId: user.id, institutionId: institution.id };
}

export async function submitChsiEducationVerification(input: {
  session: UserSession;
  institutionId: string;
  academicStatus: "enrolled" | "graduated";
  evidenceCode: string;
}): Promise<EducationSubmissionOutcome> {
  const context = await requireEducationSubmissionContext(input.session, input.institutionId);
  return db.transaction(async (tx) => {
    await lockEducationSubmissionInTx(tx, context);
    await lockChsiEvidenceCodeInTx(tx, context.userId, input.evidenceCode);

    const sameCode = await tx.select({ status: educationVerifications.status })
      .from(educationVerifications)
      .where(and(
        eq(educationVerifications.userId, context.userId),
        eq(educationVerifications.evidenceCode, input.evidenceCode),
      ))
      .for("update");
    if (sameCode.some((row) => row.status === "pending")) return "already_pending";
    if (sameCode.some((row) => row.status === "approved")) return "already_approved";
    const existingClaim = await findPendingOrApprovedClaimInTx(tx, context, input.academicStatus);
    if (existingClaim === "approved") return "already_approved";
    if (existingClaim === "pending") return "already_pending";

    const evidenceType = input.academicStatus === "enrolled" ? "chsi_enrollment_report" : "chsi_education_report";
    const [verification] = await tx.insert(educationVerifications).values({
      userId: context.userId,
      institutionId: context.institutionId,
      academicStatus: input.academicStatus,
      evidenceType,
      evidenceCode: input.evidenceCode,
    }).returning({ id: educationVerifications.id });
    if (!verification) throw new AppError(ErrorCode.INTERNAL_ERROR, "无法创建教育认证记录。");
    await insertEducationSubmissionAudit(tx, {
      actorId: auditActorId(input.session),
      targetId: verification.id,
      institutionId: context.institutionId,
      evidenceType,
    });
    return "created";
  });
}

export async function submitAdmissionNoticeEducationCommand(input: {
  session: UserSession;
  institutionId: string;
  file: ValidatedEducationEvidenceFile;
}): Promise<EducationSubmissionOutcome> {
  const context = await requireEducationSubmissionContext(input.session, input.institutionId);
  let uploadedObjectKey: string | undefined;

  try {
    return await db.transaction(async (tx) => {
      await lockEducationSubmissionInTx(tx, context);
      const existingClaim = await findPendingOrApprovedClaimInTx(tx, context, "enrolled");
      if (existingClaim === "approved") return "already_approved";
      if (existingClaim === "pending") return "already_pending";

      const verificationId = randomUUID();
      const objectKey = `${verificationId}/${randomUUID()}.${input.file.extension}`;
      await educationEvidenceStorage.upload(objectKey, input.file.file, input.file.mimeType);
      uploadedObjectKey = objectKey;

      await tx.insert(educationVerifications).values({
        id: verificationId,
        userId: context.userId,
        institutionId: context.institutionId,
        academicStatus: "enrolled",
        evidenceType: "manual_other",
        evidenceCode: null,
        evidenceObjectKey: objectKey,
        status: "pending",
      });
      await insertEducationSubmissionAudit(tx, {
        actorId: auditActorId(input.session),
        targetId: verificationId,
        institutionId: context.institutionId,
        evidenceType: "manual_other",
      });
      return "created";
    });
  } catch (error) {
    if (uploadedObjectKey) {
      try {
        await educationEvidenceStorage.remove(uploadedObjectKey);
      } catch {
        // The storage adapter has already emitted a safe dependency event;
        // this event records only that compensation was unsuccessful.
        logEvent({
          level: "error",
          event: "education.evidence_storage.compensation_failure",
          scope: "education",
          operation: "manual_submit",
          errorClass: "dependency",
          retryable: true,
          safeContext: { provider: "supabase", phase: "compensation" },
        });
      }
    }
    throw error;
  }
}

export async function lockEducationSubmissionInTx(
  tx: Pick<TxDb, "execute">,
  context: EducationSubmissionContext,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`education-manual:${context.userId}:${context.institutionId}`}, 0))`);
}

async function lockChsiEvidenceCodeInTx(tx: Pick<TxDb, "execute">, userId: string, evidenceCode: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`education-verification:${userId}:${evidenceCode}`}, 0))`);
}

async function findPendingOrApprovedClaimInTx(
  tx: Pick<TxDb, "select">,
  context: EducationSubmissionContext,
  academicStatus: "enrolled" | "graduated",
): Promise<"approved" | "pending" | null> {
  const rows = await tx.select({ status: educationVerifications.status })
    .from(educationVerifications)
    .where(and(
      eq(educationVerifications.userId, context.userId),
      eq(educationVerifications.institutionId, context.institutionId),
      eq(educationVerifications.academicStatus, academicStatus),
      inArray(educationVerifications.status, ["pending", "approved"]),
    ))
    .for("update");
  if (rows.some((row) => row.status === "approved")) return "approved";
  if (rows.some((row) => row.status === "pending")) return "pending";
  return null;
}

async function insertEducationSubmissionAudit(
  tx: Pick<TxDb, "insert">,
  input: { actorId: string; targetId: string; institutionId: string; evidenceType: "chsi_enrollment_report" | "chsi_education_report" | "manual_other" },
): Promise<void> {
  await tx.insert(auditLogs).values({
    action: "education_verification.submit",
    actorId: input.actorId,
    targetId: input.targetId,
    targetType: "education_verification",
    meta: { institutionId: input.institutionId, evidenceType: input.evidenceType },
  });
}
