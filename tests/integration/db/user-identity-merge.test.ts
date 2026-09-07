import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { buildUserMergePreflight, executeUserMergeInTx } from "../../../src/lib/identity/merge";
import { createLocalPool } from "./harness/database";

describe("canonical user identity merge PostgreSQL invariants", () => {
  it("keeps the selected profile intact, reparents person facts, retires loser competitive facts, and leaves a durable alias", async () => {
    const pool = createLocalPool();
    const ids = { canonical: randomUUID(), merged: randomUUID(), admin: randomUUID() };
    const database = drizzle(pool, { schema });
    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query(
        "INSERT INTO users (id, email, display_name, qq, role) VALUES ($1, $2, 'Selected profile', 'selected-qq', 'user'), ($3, $4, 'Loser profile', 'loser-qq', 'user'), ($5, $6, 'Merge admin', 'admin-qq', 'super_admin')",
        [ids.canonical, `canonical-${ids.canonical}@local.test`, ids.merged, `merged-${ids.merged}@local.test`, ids.admin, `merge-admin-${ids.admin}@local.test`],
      );
      await pool.query(
        "INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at) VALUES ($1, $2, 'enrolled', 'institutional_email', 'approved', 'system:local-test', now())",
        [ids.merged, institution.rows[0].id],
      );
      await pool.query(
        "INSERT INTO competitive_rank_facts (user_id, platform, kind, status, rank, rating) VALUES ($1, 'local-test', 'historical_peak', 'ranked', 'A', 1800)",
        [ids.merged],
      );
      await pool.query(
        "INSERT INTO audit_logs (action, actor_id, target_type, target_id, meta) VALUES ('local.identity.history', $1, 'user', $1, '{}'::jsonb)",
        [ids.merged],
      );

      const preflight = await buildUserMergePreflight(database, {
        canonicalUserId: ids.canonical,
        mergedUserId: ids.merged,
      }, { evidenceClass: "super_admin_review" });
      expect(preflight.executable).toBe(true);
      expect(preflight.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "reference:education_verifications.user_id", category: "AUTOMATIC", domain: "教育认证记录" }),
        expect.objectContaining({ key: "competitive:loser-profile", category: "AUTOMATIC", domain: "待归并竞技资料" }),
        expect.objectContaining({ key: "profile:canonical", category: "PRESERVE", domain: "保留账号资料" }),
      ]));

      await database.transaction((tx) => executeUserMergeInTx(tx, {
        canonicalUserId: ids.canonical,
        mergedUserId: ids.merged,
        actorUserId: ids.admin,
        expectedFingerprint: preflight.fingerprint,
        evidenceClass: "super_admin_review",
        reason: "local PostgreSQL merge invariant test",
      }));

      await expect(pool.query("SELECT count(*)::text AS count FROM education_verifications WHERE user_id = $1", [ids.canonical])).resolves.toMatchObject({ rows: [{ count: "1" }] });
      await expect(pool.query("SELECT count(*)::text AS count FROM competitive_rank_facts WHERE user_id = $1", [ids.canonical])).resolves.toMatchObject({ rows: [{ count: "0" }] });
      await expect(pool.query("SELECT display_name, qq FROM users WHERE id = $1", [ids.canonical])).resolves.toMatchObject({ rows: [{ display_name: "Selected profile", qq: "selected-qq" }] });
      await expect(pool.query("SELECT status::text, merged_into_user_id FROM users WHERE id = $1", [ids.merged])).resolves.toMatchObject({ rows: [{ status: "merged", merged_into_user_id: ids.canonical }] });
      await expect(pool.query("SELECT canonical_user_id, merged_user_id FROM user_merge_ledger WHERE merged_user_id = $1", [ids.merged])).resolves.toMatchObject({ rows: [{ canonical_user_id: ids.canonical, merged_user_id: ids.merged }] });
      await expect(pool.query("SELECT actor_id FROM audit_logs WHERE action = 'local.identity.history' AND target_id = $1", [ids.merged])).resolves.toMatchObject({ rows: [{ actor_id: ids.merged }] });
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])", [[ids.canonical, ids.merged, ids.admin]]).catch(() => {});
      await pool.query("DELETE FROM user_merge_ledger WHERE merged_user_id = $1", [ids.merged]).catch(() => {});
      await pool.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [[ids.canonical, ids.merged]]).catch(() => {});
      await pool.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [[ids.canonical, ids.merged]]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.canonical, ids.merged, ids.admin]]).catch(() => {});
      await pool.end();
    }
  });
});
