import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { purgeExpiredEducationEvidence } from "../../../src/lib/education/retention";
import { createLocalPool } from "./harness/database";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type EducationVerificationRow = {
  id: string;
  user_id: string;
  institution_id: string;
  academic_status: string;
  evidence_type: string;
  evidence_code: string | null;
  status: string;
  submitted_at: Date;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  updated_at: Date;
};

async function readVerification(pool: ReturnType<typeof createLocalPool>, id: string): Promise<EducationVerificationRow> {
  const result = await pool.query<EducationVerificationRow>(
    `SELECT id, user_id, institution_id, academic_status::text AS academic_status,
            evidence_type::text AS evidence_type, evidence_code,
            status::text AS status, submitted_at, reviewed_by, reviewed_at,
            review_note, created_at, updated_at
     FROM education_verifications WHERE id = $1`,
    [id],
  );
  if (!result.rows[0]) throw new Error(`education verification ${id} not found`);
  return result.rows[0];
}

describe("education evidence retention command", () => {
  it("clears only eligible evidence at the seven-day boundary and is idempotent", async () => {
    const pool = createLocalPool({ max: 2 });
    const userId = randomUUID();
    const verificationIds = {
      boundaryApproved: randomUUID(),
      olderRejected: randomUUID(),
      justInsideApproved: randomUUID(),
      pendingOld: randomUUID(),
      recentRejected: randomUUID(),
      approvedWithoutReviewTime: randomUUID(),
      approvedWithoutEvidence: randomUUID(),
    };
    const now = new Date("2026-09-03T00:00:00.000Z");
    const reviewedBefore = new Date(now.getTime() - RETENTION_MS);

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `education-retention-${userId}@local.test`]);

      const rows = [
        { id: verificationIds.boundaryApproved, status: "approved", evidenceCode: "AAAA1111BBBB2222", reviewedAt: reviewedBefore, reviewedBy: "admin-boundary", reviewNote: "边界审核" },
        { id: verificationIds.olderRejected, status: "rejected", evidenceCode: "CCCC3333DDDD4444", reviewedAt: new Date(reviewedBefore.getTime() - 1), reviewedBy: "admin-rejected", reviewNote: "学校不一致" },
        { id: verificationIds.justInsideApproved, status: "approved", evidenceCode: "EEEE5555FFFF6666", reviewedAt: new Date(reviewedBefore.getTime() + 1), reviewedBy: "admin-recent", reviewNote: null },
        { id: verificationIds.pendingOld, status: "pending", evidenceCode: "GGGG7777HHHH8888", reviewedAt: new Date(reviewedBefore.getTime() - 1), reviewedBy: null, reviewNote: null },
        { id: verificationIds.recentRejected, status: "rejected", evidenceCode: "IIII9999JJJJ0000", reviewedAt: new Date(now.getTime() - 60 * 60 * 1000), reviewedBy: "admin-recent-reject", reviewNote: "待复核" },
        { id: verificationIds.approvedWithoutReviewTime, status: "approved", evidenceCode: "KKKK1111LLLL2222", reviewedAt: null, reviewedBy: "admin-missing-time", reviewNote: null },
        { id: verificationIds.approvedWithoutEvidence, status: "approved", evidenceCode: null, reviewedAt: new Date(reviewedBefore.getTime() - 1), reviewedBy: "admin-no-code", reviewNote: null },
      ] as const;

      const submittedAt = new Date(now.getTime() - RETENTION_MS - 60 * 60 * 1000);
      const createdAt = new Date(now.getTime() - RETENTION_MS - 2 * 60 * 60 * 1000);
      const updatedAt = new Date(now.getTime() - RETENTION_MS - 90 * 60 * 1000);
      for (const row of rows) {
        await pool.query(
          `INSERT INTO education_verifications
             (id, user_id, institution_id, academic_status, evidence_type,
              evidence_code, status, submitted_at, reviewed_by, reviewed_at,
              review_note, created_at, updated_at)
           VALUES ($1, $2, $3, 'graduated', 'chsi_education_report', $4, $5,
                   $6, $7, $8, $9, $10, $11)`,
          [row.id, userId, institution.rows[0].id, row.evidenceCode, row.status, submittedAt, row.reviewedBy, row.reviewedAt, row.reviewNote, createdAt, updatedAt],
        );
      }

      const before = new Map<string, EducationVerificationRow>();
      for (const id of [verificationIds.boundaryApproved, verificationIds.olderRejected]) {
        before.set(id, await readVerification(pool, id));
      }

      await expect(purgeExpiredEducationEvidence(now)).resolves.toBe(2);

      for (const id of [verificationIds.boundaryApproved, verificationIds.olderRejected]) {
        const previous = before.get(id)!;
        await expect(readVerification(pool, id)).resolves.toEqual({ ...previous, evidence_code: null });
      }

      const state = await pool.query<{ id: string; status: string; evidence_code: string | null }>(
        `SELECT id, status::text AS status, evidence_code
         FROM education_verifications WHERE id = ANY($1::uuid[])`,
        [Object.values(verificationIds)],
      );
      expect(new Map(state.rows.map((row) => [row.id, { status: row.status, evidenceCode: row.evidence_code }]))).toEqual(new Map([
        [verificationIds.boundaryApproved, { status: "approved", evidenceCode: null }],
        [verificationIds.olderRejected, { status: "rejected", evidenceCode: null }],
        [verificationIds.justInsideApproved, { status: "approved", evidenceCode: "EEEE5555FFFF6666" }],
        [verificationIds.pendingOld, { status: "pending", evidenceCode: "GGGG7777HHHH8888" }],
        [verificationIds.recentRejected, { status: "rejected", evidenceCode: "IIII9999JJJJ0000" }],
        [verificationIds.approvedWithoutReviewTime, { status: "approved", evidenceCode: "KKKK1111LLLL2222" }],
        [verificationIds.approvedWithoutEvidence, { status: "approved", evidenceCode: null }],
      ]));

      await expect(purgeExpiredEducationEvidence(now)).resolves.toBe(0);
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = ANY($1::uuid[])", [Object.values(verificationIds)]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      await pool.end();
    }
  });
});
