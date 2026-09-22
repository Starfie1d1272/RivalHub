import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { purgeExpiredEducationEvidence } from "../../../src/lib/education/retention";
import { createLocalPool } from "./harness/database";

const { removeMock } = vi.hoisted(() => ({ removeMock: vi.fn() }));

vi.mock("@/lib/education/storage", () => ({
  educationEvidenceStorage: { remove: removeMock },
}));

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

describe("manual education evidence retention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes eligible objects before clearing their database refs and preserves history", async () => {
    const pool = createLocalPool({ max: 2 });
    const userId = randomUUID();
    const ids = {
      boundaryApproved: randomUUID(),
      olderRejected: randomUUID(),
      recentApproved: randomUUID(),
      pendingOld: randomUUID(),
    };
    const now = new Date("2026-09-03T00:00:00.000Z");
    const reviewedBefore = new Date(now.getTime() - RETENTION_MS);
    const keys = {
      boundaryApproved: `${ids.boundaryApproved}/boundary.png`,
      olderRejected: `${ids.olderRejected}/older.webp`,
      recentApproved: `${ids.recentApproved}/recent.jpg`,
      pendingOld: `${ids.pendingOld}/pending.png`,
    };

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `education-manual-retention-${userId}@local.test`]);
      await pool.query(
        `INSERT INTO education_verifications
           (id, user_id, institution_id, academic_status, evidence_type, evidence_object_key, status, reviewed_by, reviewed_at, review_note)
         VALUES
           ($1, $5, $6, 'enrolled', 'manual_other', $7, 'approved', 'admin-a', $12, '通过'),
           ($2, $5, $6, 'enrolled', 'manual_other', $8, 'rejected', 'admin-b', $11, '材料不清晰'),
           ($3, $5, $6, 'enrolled', 'manual_other', $9, 'approved', 'admin-c', $13, '近期通过'),
           ($4, $5, $6, 'enrolled', 'manual_other', $10, 'pending', NULL, NULL, NULL)`,
        [
          ids.boundaryApproved,
          ids.olderRejected,
          ids.recentApproved,
          ids.pendingOld,
          userId,
          institution.rows[0].id,
          keys.boundaryApproved,
          keys.olderRejected,
          keys.recentApproved,
          keys.pendingOld,
          new Date(reviewedBefore.getTime() - 1),
          reviewedBefore,
          new Date(reviewedBefore.getTime() + 1),
        ],
      );

      removeMock.mockResolvedValue(undefined);
      await expect(purgeExpiredEducationEvidence(now)).resolves.toBe(2);
      expect(removeMock).toHaveBeenCalledTimes(2);
      expect(removeMock).toHaveBeenNthCalledWith(1, expect.stringMatching(new RegExp(`^(${ids.boundaryApproved}|${ids.olderRejected})/`)));
      expect(removeMock).toHaveBeenNthCalledWith(2, expect.stringMatching(new RegExp(`^(${ids.boundaryApproved}|${ids.olderRejected})/`)));

      const rows = await pool.query<{ id: string; evidence_object_key: string | null; status: string; review_note: string | null }>(
        `SELECT id, evidence_object_key, status::text AS status, review_note
         FROM education_verifications WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [Object.values(ids)],
      );
      expect(rows.rows.find((row) => row.id === ids.boundaryApproved)).toMatchObject({ evidence_object_key: null, status: "approved", review_note: "通过" });
      expect(rows.rows.find((row) => row.id === ids.olderRejected)).toMatchObject({ evidence_object_key: null, status: "rejected", review_note: "材料不清晰" });
      expect(rows.rows.find((row) => row.id === ids.recentApproved)).toMatchObject({ evidence_object_key: keys.recentApproved, status: "approved" });
      expect(rows.rows.find((row) => row.id === ids.pendingOld)).toMatchObject({ evidence_object_key: keys.pendingOld, status: "pending" });
      await expect(purgeExpiredEducationEvidence(now)).resolves.toBe(0);
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = ANY($1::uuid[])", [Object.values(ids)]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
      await pool.end();
    }
  });

  it("retains the database key after a delete failure and retries it later", async () => {
    const pool = createLocalPool({ max: 2 });
    const userId = randomUUID();
    const verificationId = randomUUID();
    const objectKey = `${verificationId}/retry.png`;
    const now = new Date("2026-09-03T00:00:00.000Z");

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `education-manual-retention-retry-${userId}@local.test`]);
      await pool.query(
        `INSERT INTO education_verifications
           (id, user_id, institution_id, academic_status, evidence_type, evidence_object_key, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, 'enrolled', 'manual_other', $4, 'approved', 'admin-retry', $5)`,
        [verificationId, userId, institution.rows[0].id, objectKey, new Date(now.getTime() - RETENTION_MS)],
      );

      removeMock.mockRejectedValueOnce(new AppError(ErrorCode.INTERNAL_ERROR, "教育材料存储服务暂时不可用，请稍后重试。"));
      await expect(purgeExpiredEducationEvidence(now)).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
      await expect(pool.query("SELECT evidence_object_key FROM education_verifications WHERE id = $1", [verificationId])).resolves.toMatchObject({ rows: [{ evidence_object_key: objectKey }] });

      removeMock.mockResolvedValueOnce(undefined);
      await expect(purgeExpiredEducationEvidence(now)).resolves.toBe(1);
      await expect(pool.query("SELECT evidence_object_key FROM education_verifications WHERE id = $1", [verificationId])).resolves.toMatchObject({ rows: [{ evidence_object_key: null }] });
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = $1", [verificationId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
      await pool.end();
    }
  });
});
