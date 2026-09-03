import "server-only";

import { and, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications } from "@/db/schema";

const EDUCATION_EVIDENCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 清理已完成教育认证的临时核验凭证。
 *
 * 认证结果和审核事实是长期事实，只有 evidenceCode 按 retention policy
 * 清空。单条 UPDATE 配合数据库条件也让重复 Cron 调用自然幂等。
 */
export async function purgeExpiredEducationEvidence(now = new Date()): Promise<number> {
  const reviewedBefore = new Date(now.getTime() - EDUCATION_EVIDENCE_RETENTION_MS);
  const cleared = await db
    .update(educationVerifications)
    .set({ evidenceCode: null })
    .where(and(
      ne(educationVerifications.status, "pending"),
      lte(educationVerifications.reviewedAt, reviewedBefore),
      isNotNull(educationVerifications.evidenceCode),
    ))
    .returning({ id: educationVerifications.id });

  return cleared.length;
}
