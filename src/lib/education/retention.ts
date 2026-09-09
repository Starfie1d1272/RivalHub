import "server-only";

import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications } from "@/db/schema";
import { educationEvidenceStorage } from "./storage";

const EDUCATION_EVIDENCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 清理已完成教育认证的临时核验凭证。
 *
 * 认证结果和审核事实是长期事实，只有临时 evidence 按 retention policy
 * 清理。Storage object 必须先删除，数据库 object key 只有在删除成功后才
 * 清空；缺失 object 由 Storage owner 按幂等删除成功处理。
 */
export async function purgeExpiredEducationEvidence(now = new Date()): Promise<number> {
  const reviewedBefore = new Date(now.getTime() - EDUCATION_EVIDENCE_RETENTION_MS);
  const manualRows = await db
    .select({ id: educationVerifications.id, evidenceObjectKey: educationVerifications.evidenceObjectKey })
    .from(educationVerifications)
    .where(and(
      ne(educationVerifications.status, "pending"),
      lte(educationVerifications.reviewedAt, reviewedBefore),
      eq(educationVerifications.evidenceType, "manual_other"),
      isNotNull(educationVerifications.evidenceObjectKey),
    ));

  let manualCleared = 0;
  for (const row of manualRows) {
    if (!row.evidenceObjectKey) continue;
    await educationEvidenceStorage.remove(row.evidenceObjectKey);
    const cleared = await db
      .update(educationVerifications)
      .set({ evidenceObjectKey: null })
      .where(and(
        eq(educationVerifications.id, row.id),
        eq(educationVerifications.evidenceObjectKey, row.evidenceObjectKey),
      ))
      .returning({ id: educationVerifications.id });
    manualCleared += cleared.length;
  }

  const chsiCleared = await db
    .update(educationVerifications)
    .set({ evidenceCode: null })
    .where(and(
      ne(educationVerifications.status, "pending"),
      lte(educationVerifications.reviewedAt, reviewedBefore),
      ne(educationVerifications.evidenceType, "manual_other"),
      isNotNull(educationVerifications.evidenceCode),
    ))
    .returning({ id: educationVerifications.id });

  return manualCleared + chsiCleared.length;
}
