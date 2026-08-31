import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import * as schema from "../../../src/db/schema";
import { claimAdminInviteInTx } from "../../../src/lib/auth/admin-invites";
import { createLocalPool } from "./harness/database";

/**
 * Local PostgreSQL evidence for the production invite claim command.
 * Two real transactions compete for maxUses=1; the test never reimplements
 * the claim SQL outside claimAdminInviteInTx.
 */
describe("admin invite claim command", () => {
  it("serializes concurrent claims, records one grant, and rejects duplicates", async () => {
    const pool = createLocalPool({ max: 4 });
    const appDb = drizzle(pool, { schema });
    const seasonId = randomUUID();
    const inviteId = randomUUID();
    const creatorId = randomUUID();
    const claimantIds = [randomUUID(), randomUUID()];
    const claimantEmails = claimantIds.map((id, index) => `invite-${index}-${id}@local.test`);
    const inviteCode = `LOCAL-${inviteId}`;
    let globalInviteId: string | null = null;
    let duplicateInviteId: string | null = null;

    try {
      await pool.query(
        `INSERT INTO seasons (id, slug, name, kind, status)
         VALUES ($1, $2, 'Invite concurrency', 'Rivals', 'draft')`,
        [seasonId, `local-invite-${seasonId}`],
      );
      await pool.query(
        `INSERT INTO users (id, email, role) VALUES ($1, $2, 'user'), ($3, $4, 'user'), ($5, $6, 'user')`,
        [creatorId, `creator-${creatorId}@local.test`, claimantIds[0], claimantEmails[0], claimantIds[1], claimantEmails[1]],
      );
      await pool.query(
        `INSERT INTO admin_invites (id, code, created_by, role, season_id, max_uses, is_active)
         VALUES ($1, $2, $3, 'season_admin', $4, 1, true)`,
        [inviteId, inviteCode, creatorId, seasonId],
      );

      const claim = (userId: string) =>
        appDb.transaction((tx) =>
          claimAdminInviteInTx(tx, { code: inviteCode, userId }),
        );
      const results = await Promise.allSettled(
        claimantIds.map((userId) => claim(userId)),
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const successfulIndex = results.findIndex((result) => result.status === "fulfilled");
      expect(successfulIndex).toBeGreaterThanOrEqual(0);
      const successfulUserId = claimantIds[successfulIndex]!;
      const globalClaimantId = claimantIds[successfulIndex === 0 ? 1 : 0]!;

      const claimRows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM admin_invite_claims WHERE invite_id = $1`,
        [inviteId],
      );
      const grantRows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM season_admin_grants WHERE season_id = $1`,
        [seasonId],
      );
      const inviteRow = await pool.query<{ is_active: boolean }>(
        `SELECT is_active FROM admin_invites WHERE id = $1`,
        [inviteId],
      );
      const auditRows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_logs WHERE action = 'user.claim_invite' AND target_id = ANY($1::text[])`,
        [claimantIds],
      );

      expect(claimRows.rows[0]?.count).toBe("1");
      expect(grantRows.rows[0]?.count).toBe("1");
      expect(inviteRow.rows[0]?.is_active).toBe(false);
      expect(auditRows.rows[0]?.count).toBe("1");

      const exactGrantRows = await pool.query<{ season_id: string }>(
        `SELECT season_id FROM season_admin_grants WHERE user_id = $1`,
        [successfulUserId],
      );
      expect(exactGrantRows.rows).toEqual([{ season_id: seasonId }]);

      globalInviteId = randomUUID();
      const globalInviteCode = `LOCAL-${globalInviteId}`;
      await pool.query(
        `INSERT INTO admin_invites (id, code, created_by, role, season_id, max_uses, is_active)
         VALUES ($1, $2, $3, 'super_admin', NULL, 1, true)`,
        [globalInviteId, globalInviteCode, creatorId],
      );
      await expect(
        appDb.transaction((tx) => claimAdminInviteInTx(tx, {
          code: globalInviteCode,
          userId: globalClaimantId,
        })),
      ).resolves.toMatchObject({ role: "super_admin", userId: globalClaimantId });
      const globalUser = await pool.query<{ role: string }>(
        `SELECT role::text FROM users WHERE id = $1`,
        [globalClaimantId],
      );
      expect(globalUser.rows[0]?.role).toBe("super_admin");

      duplicateInviteId = randomUUID();
      const duplicateCode = `LOCAL-${duplicateInviteId}`;
      await pool.query(
        `INSERT INTO admin_invites (id, code, created_by, role, season_id, max_uses, is_active)
         VALUES ($1, $2, $3, 'season_admin', $4, 2, true)`,
        [duplicateInviteId, duplicateCode, creatorId, seasonId],
      );
      await expect(
        appDb.transaction((tx) => claimAdminInviteInTx(tx, {
          code: duplicateCode,
          userId: claimantIds[0],
        })),
      ).resolves.toMatchObject({ role: "season_admin", userId: claimantIds[0] });
      await expect(
        appDb.transaction((tx) => claimAdminInviteInTx(tx, {
          code: duplicateCode,
          userId: claimantIds[0],
        })),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      const duplicateClaims = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM admin_invite_claims WHERE invite_id = $1`,
        [duplicateInviteId],
      );
      expect(duplicateClaims.rows[0]?.count).toBe("1");
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE target_id = ANY($1::text[])", [claimantIds]);
      await pool.query("DELETE FROM admin_invites WHERE id = ANY($1::uuid[])", [[inviteId, globalInviteId, duplicateInviteId].filter(Boolean)]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[creatorId, ...claimantIds]]);
      await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
      await pool.end();
    }
  });
});
