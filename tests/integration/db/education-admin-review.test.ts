import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { reviewEducationVerification } from "@/actions/education-verifications";
import { getEducationReviewQueue, getEducationReviewPage, getEducationReviewOverview, normalizeEducationReviewQuery } from "../../../src/lib/education/admin-review";
import { createLocalPool } from "./harness/database";

const { requireSuperAdmin } = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSuperAdmin,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function loadQueue(params: Record<string, string>) {
  return getEducationReviewQueue(normalizeEducationReviewQuery(new URLSearchParams(params)));
}

describe("education review queue PostgreSQL read model", () => {
  it("commits one decision and audit when two administrators review the same pending claim", async () => {
    const pool = createLocalPool();
    const institutionId = randomUUID();
    const userId = randomUUID();
    const verificationId = randomUUID();
    requireSuperAdmin.mockResolvedValue({ userId });
    let reviews: ReturnType<typeof reviewEducationVerification>[] = [];
    const blocker = await pool.connect();
    try {
      await pool.query("INSERT INTO institutions (id,name,source,source_version) VALUES ($1,'Review concurrency','manual','fixture')", [institutionId]);
      await pool.query("INSERT INTO users (id,email) VALUES ($1,$2)", [userId, `${userId}@local.test`]);
      await pool.query("INSERT INTO education_verifications (id,user_id,institution_id,academic_status,evidence_type,status) VALUES ($1,$2,$3,'enrolled','chsi_enrollment_report','pending')", [verificationId, userId, institutionId]);
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM education_verifications WHERE id=$1 FOR UPDATE", [verificationId]);
      const [{ pid }] = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      reviews = [
        reviewEducationVerification({ id: verificationId, decision: "approved" }),
        reviewEducationVerification({ id: verificationId, decision: "rejected", reviewNote: "需要更正" }),
      ];
      await expect.poll(async () => (await pool.query(
        `WITH RECURSIVE blocked AS (
          SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
        ) SELECT pid FROM blocked`, [pid],
      )).rowCount, { timeout: 2000, interval: 10 }).toBe(2);
      await blocker.query("COMMIT");
      const results = await Promise.all(reviews);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results).toContainEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      }));
      const audits = (await pool.query("SELECT action FROM audit_logs WHERE target_id=$1", [verificationId])).rows;
      const [verification] = (await pool.query("SELECT status FROM education_verifications WHERE id=$1", [verificationId])).rows;
      expect(audits).toEqual([{ action: `education_verification.${verification.status}` }]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(reviews);
      await pool.query("DELETE FROM audit_logs WHERE target_id=$1", [verificationId]);
      await pool.query("DELETE FROM education_verifications WHERE id=$1", [verificationId]);
      await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      await pool.query("DELETE FROM institutions WHERE id=$1", [institutionId]);
      await pool.end();
    }
  });

  it("withholds expired evidence and its search matches before physical cleanup, preserving review history", async () => {
    const pool = createLocalPool();
    const marker = `expiry-${randomUUID()}`;
    const institutionId = randomUUID();
    const userIds = Array.from({ length: 3 }, () => randomUUID());
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const codes = [randomUUID(), randomUUID()].map(value => value.replaceAll("-", "").slice(0, 16).toUpperCase());
    try {
      await pool.query("INSERT INTO institutions (id,name,source,source_version) VALUES ($1,$2,'manual','fixture')", [institutionId, marker]);
      for (const id of userIds) await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [id, `${id}@local.test`, marker]);
      await pool.query(`INSERT INTO education_verifications (id,user_id,institution_id,academic_status,evidence_type,status,evidence_code,evidence_object_key,reviewed_at) VALUES
        ($1,$4,$7,'enrolled','chsi_enrollment_report','pending',$8,NULL,NULL),
        ($2,$5,$7,'enrolled','chsi_enrollment_report','approved',$9,NULL,now()-interval '8 days'),
        ($3,$6,$7,'enrolled','manual_other','rejected',NULL,'private-fixture-key',now()-interval '8 days')`, [...ids,...userIds,institutionId,...codes]);
      const query = normalizeEducationReviewQuery(new URLSearchParams({ q: marker, status: "all" }));
      const queue = await getEducationReviewQueue(query);
      const [page, overview] = await Promise.all([getEducationReviewPage(query), getEducationReviewOverview()]);
      expect({ ...page, overview }).toEqual(queue);
      expect(overview.institutionDistribution.find(row => row.id === institutionId)?.identityCount).toBe(1);
      const byId = new Map(queue.rows.map(row => [row.id,row]));
      expect(byId.get(ids[0]!)).toMatchObject({ chsiEvidenceCode: codes[0] });
      expect(byId.get(ids[1]!)).toMatchObject({ chsiEvidenceCode: null, status: "approved" });
      expect(byId.get(ids[2]!)).toMatchObject({ manualEvidenceAvailable: false, status: "rejected" });
      expect((await loadQueue({ q: codes[1]!, status: "all" })).total).toBe(0);
      expect((await loadQueue({ q: codes[0]!, status: "all" })).total).toBe(1);
      expect((await pool.query("SELECT evidence_code,evidence_object_key FROM education_verifications WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows).toHaveLength(3);
      expect((await pool.query("SELECT evidence_code FROM education_verifications WHERE id=$1", [ids[1]])).rows[0].evidence_code).toBe(codes[1]);
      expect(JSON.stringify(queue)).not.toContain("private-fixture-key");
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id=ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM institutions WHERE id=$1", [institutionId]);
      await pool.end();
    }
  });
});
