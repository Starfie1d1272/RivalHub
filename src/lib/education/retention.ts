import "server-only";

import { and, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications } from "@/db/schema";
import { EDUCATION_EVIDENCE_BUCKET, educationEvidenceStorage } from "./storage";
import { purgeExpiredEducationEvidence as purgeWithStore } from "./retention-core";

/**
 * 清理已完成教育认证的临时核验凭证。
 *
 * 认证结果和审核事实是长期事实，只有临时 evidence 按 retention policy
 * 清理。Storage object 必须先删除，数据库 object key 只有在删除成功后才
 * 清空；缺失 object 由 Storage owner 按幂等删除成功处理。
 */
export async function purgeExpiredEducationEvidence(now = new Date()): Promise<number> {
  return purgeWithStore(
    {
      findExpiredManualEvidence: async (reviewedBefore) =>
        db
          .select({
            id: educationVerifications.id,
            evidenceObjectKey: educationVerifications.evidenceObjectKey,
          })
          .from(educationVerifications)
          .where(
            and(
              ne(educationVerifications.status, "pending"),
              lte(educationVerifications.reviewedAt, reviewedBefore),
              eq(educationVerifications.evidenceType, "manual_other"),
              isNotNull(educationVerifications.evidenceObjectKey),
            ),
          )
          .then((rows) =>
            rows.flatMap((row) =>
              row.evidenceObjectKey
                ? [{ id: row.id, evidenceObjectKey: row.evidenceObjectKey }]
                : [],
            ),
          ),
      removeEvidenceObject: (objectKey) => educationEvidenceStorage.remove(objectKey),
      clearManualEvidence: async (id, objectKey) =>
        (
          await db
            .update(educationVerifications)
            .set({ evidenceObjectKey: null })
            .where(
              and(
                eq(educationVerifications.id, id),
                eq(educationVerifications.evidenceObjectKey, objectKey),
              ),
            )
            .returning({ id: educationVerifications.id })
        ).length,
      clearExpiredChsiCodes: async (reviewedBefore) =>
        (
          await db
            .update(educationVerifications)
            .set({ evidenceCode: null })
            .where(
              and(
                ne(educationVerifications.status, "pending"),
                lte(educationVerifications.reviewedAt, reviewedBefore),
                ne(educationVerifications.evidenceType, "manual_other"),
                isNotNull(educationVerifications.evidenceCode),
              ),
            )
            .returning({ id: educationVerifications.id })
        ).length,
    },
    now,
  );
}

/** Storage metadata is read-only. Each key is minted once and uploaded before its DB reference. */
export async function purgeOrphanedEducationEvidence(now = new Date()): Promise<number> {
  // Aged keys can no longer be part of a live submission. A missed compensation
  // is retried by the daily job, including uploads that finished after timeout.
  const before = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { rows } = await db.execute<{ name: string }>(sql`
    SELECT o.name FROM storage.objects o
    WHERE o.bucket_id = ${EDUCATION_EVIDENCE_BUCKET}
      AND o.created_at < ${before.toISOString()}::timestamptz
      AND o.name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      AND NOT EXISTS (
        SELECT 1 FROM ${educationVerifications} WHERE ${educationVerifications.evidenceObjectKey} = o.name
      )
    ORDER BY o.created_at, o.name LIMIT 50
  `);
  await educationEvidenceStorage.removeMany(rows.map(({ name }) => name));
  return rows.length;
}
