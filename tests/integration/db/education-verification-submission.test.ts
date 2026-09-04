import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { submitEducationVerification } from "../../../src/actions/education-verifications";
import { ErrorCode } from "../../../src/lib/errors";
import { createLocalPool } from "./harness/database";

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSuperAdmin: vi.fn(),
  auditActorId: (session: { userId: string }) => session.userId,
}));

describe("education verification submission PostgreSQL invariants", () => {
  it("keeps repeated and concurrent normalized codes idempotent without merging different-code history", async () => {
    const pool = createLocalPool({ max: 4 });
    const userId = randomUUID();
    const email = `education-submit-${userId}@local.test`;
    const firstCode = "abcd-1234-efgh-5678";
    const secondCode = "1234-5678-9012";
    const concurrentCode = "QWER1234ASDF5678";

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
      requireAuthMock.mockResolvedValue({ userId, email });

      await expect(submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "enrolled", evidenceCode: firstCode })).resolves.toEqual({ success: true, data: "created" });
      const first = await pool.query<{ id: string; evidence_code: string; status: string }>("SELECT id, evidence_code, status::text AS status FROM education_verifications WHERE user_id = $1", [userId]);
      expect(first.rows).toEqual([{ id: expect.any(String), evidence_code: "ABCD1234EFGH5678", status: "pending" }]);

      await expect(submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "graduated", evidenceCode: " abcd 1234 efgh 5678 " })).resolves.toEqual({ success: true, data: "already_pending" });
      await expect(pool.query("SELECT count(*)::text AS count FROM education_verifications WHERE user_id = $1", [userId])).resolves.toMatchObject({ rows: [{ count: "1" }] });
      await expect(pool.query("SELECT count(*)::text AS count FROM audit_logs WHERE actor_id = $1 AND action = 'education_verification.submit'", [userId])).resolves.toMatchObject({ rows: [{ count: "1" }] });

      const firstId = first.rows[0]!.id;
      await pool.query("UPDATE education_verifications SET status = 'approved', reviewed_by = 'local-admin', reviewed_at = now() WHERE id = $1", [firstId]);
      await expect(submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "enrolled", evidenceCode: "ABCD-1234-EFGH-5678" })).resolves.toEqual({ success: true, data: "already_approved" });

      await expect(submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "graduated", evidenceCode: secondCode })).resolves.toEqual({ success: true, data: "created" });
      const second = await pool.query<{ id: string }>("SELECT id FROM education_verifications WHERE user_id = $1 AND evidence_code = $2", [userId, "123456789012"]);
      expect(second.rows).toHaveLength(1);
      await pool.query("UPDATE education_verifications SET status = 'rejected', reviewed_by = 'local-admin', reviewed_at = now(), review_note = '学校不一致' WHERE id = $1", [second.rows[0]!.id]);
      await expect(submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "graduated", evidenceCode: "1234 5678 9012" })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED, message: expect.stringContaining("此前已被驳回") } });

      const concurrentResults = await Promise.all([
        submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "enrolled", evidenceCode: concurrentCode }),
        submitEducationVerification({ institutionId: institution.rows[0].id, academicStatus: "enrolled", evidenceCode: concurrentCode.toLowerCase() }),
      ]);
      expect(concurrentResults.map((result) => result.success ? result.data : result.error.code).sort()).toEqual(["already_pending", "created"]);

      const finalRows = await pool.query<{ evidence_code: string; status: string; review_note: string | null }>("SELECT evidence_code, status::text AS status, review_note FROM education_verifications WHERE user_id = $1 ORDER BY created_at", [userId]);
      expect(finalRows.rows).toEqual([
        { evidence_code: "ABCD1234EFGH5678", status: "approved", review_note: null },
        { evidence_code: "123456789012", status: "rejected", review_note: "学校不一致" },
        { evidence_code: "QWER1234ASDF5678", status: "pending", review_note: null },
      ]);
      await expect(pool.query("SELECT count(*)::text AS count FROM audit_logs WHERE actor_id = $1 AND action = 'education_verification.submit'", [userId])).resolves.toMatchObject({ rows: [{ count: "3" }] });
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE actor_id = $1", [userId]).catch(() => {});
      await pool.query("DELETE FROM education_verifications WHERE user_id = $1", [userId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
      await pool.end();
    }
  });
});
