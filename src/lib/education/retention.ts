import "server-only";

import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications } from "@/db/schema";
import { educationEvidenceStorage } from "./storage";
import { purgeExpiredEducationEvidence as purgeWithStore } from "./retention-core";

/**
 * 清理已完成教育认证的临时核验凭证。
 *
 * 认证结果和审核事实是长期事实，只有临时 evidence 按 retention policy
 * 清理。Storage object 必须先删除，数据库 object key 只有在删除成功后才
 * 清空；缺失 object 由 Storage owner 按幂等删除成功处理。
 */
export async function purgeExpiredEducationEvidence(now = new Date()): Promise<number> {
  return purgeWithStore({
    findExpiredManualEvidence: async (reviewedBefore) => db
      .select({ id: educationVerifications.id, evidenceObjectKey: educationVerifications.evidenceObjectKey })
      .from(educationVerifications)
      .where(and(
        ne(educationVerifications.status, "pending"),
        lte(educationVerifications.reviewedAt, reviewedBefore),
        eq(educationVerifications.evidenceType, "manual_other"),
        isNotNull(educationVerifications.evidenceObjectKey),
      ))
      .then((rows) => rows.flatMap((row) => row.evidenceObjectKey ? [{ id: row.id, evidenceObjectKey: row.evidenceObjectKey }] : [])),
    removeEvidenceObject: (objectKey) => educationEvidenceStorage.remove(objectKey),
    clearManualEvidence: async (id, objectKey) => (await db
      .update(educationVerifications)
      .set({ evidenceObjectKey: null })
      .where(and(
        eq(educationVerifications.id, id),
        eq(educationVerifications.evidenceObjectKey, objectKey),
      ))
      .returning({ id: educationVerifications.id })).length,
    clearExpiredChsiCodes: async (reviewedBefore) => (await db
      .update(educationVerifications)
      .set({ evidenceCode: null })
      .where(and(
        ne(educationVerifications.status, "pending"),
        lte(educationVerifications.reviewedAt, reviewedBefore),
        ne(educationVerifications.evidenceType, "manual_other"),
        isNotNull(educationVerifications.evidenceCode),
      ))
      .returning({ id: educationVerifications.id })).length,
  }, now);
}
