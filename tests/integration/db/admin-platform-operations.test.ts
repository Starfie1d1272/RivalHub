import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getPlatformOperationsOverview } from "../../../src/lib/admin/platform-operations/overview";
import { createLocalPool } from "./harness/database";

describe("admin platform operations PostgreSQL read model", () => {
  it("keeps platform counts separate from season state and filters inactive owners and memberships", async () => {
    const pool = createLocalPool({ max: 8 });
    const now = new Date("2026-09-15T04:00:00.000Z");
    const recent = new Date("2026-09-14T16:30:00.000Z");
    const oldTenDays = new Date("2026-09-05T04:00:00.000Z");
    const oldThirtyOneDays = new Date("2026-08-15T04:00:00.000Z");
    const endedStartedAt = new Date("2026-09-01T04:00:00.000Z");
    const endedAt = new Date("2026-09-02T04:00:00.000Z");
    const ids = {
      captain: randomUUID(),
      member: randomUUID(),
      certifiedNoTeam: randomUUID(),
      lft: randomUUID(),
      merged: randomUUID(),
      activeTeam: randomUUID(),
      disbandedTeam: randomUUID(),
      institution: randomUUID(),
      captainVerification: randomUUID(),
      certifiedVerification: randomUUID(),
      teamIntent: randomUUID(),
      lftIntent: randomUUID(),
      mergedIntent: randomUUID(),
      disbandedTeamIntent: randomUUID(),
      activeCaptainChange: randomUUID(),
      disbandedCaptainChange: randomUUID(),
      activeNameChange: randomUUID(),
      disbandedNameChange: randomUUID(),
      captainMembership: randomUUID(),
      memberMembership: randomUUID(),
      mergedMembership: randomUUID(),
      endedMembership: randomUUID(),
    };
    const userIds = [ids.captain, ids.member, ids.certifiedNoTeam, ids.lft, ids.merged];
    const teamIds = [ids.activeTeam, ids.disbandedTeam];

    try {
      const before = await getPlatformOperationsOverview(now);
      const fixture = await pool.connect();
      try {
        await fixture.query("BEGIN");
        await fixture.query(
          `INSERT INTO institutions (id, name, source, source_version)
           VALUES ($1, $2, 'manual', 'admin-platform-operations-test')`,
          [ids.institution, `Platform Operations Test ${ids.institution}`],
        );
        await fixture.query(
          `INSERT INTO users (id, email, status, merged_into_user_id, merged_at, created_at, updated_at)
           VALUES ($1, $2, 'active', NULL, NULL, $7, $7),
                  ($3, $4, 'active', NULL, NULL, $7, $7),
                  ($5, $6, 'active', NULL, NULL, $8, $8),
                  ($9, $10, 'active', NULL, NULL, $11, $11),
                  ($12, $13, 'merged', $1, $7, $7, $7)`,
          [
            ids.captain, `platform-operations-captain-${ids.captain}@local.test`,
            ids.member, `platform-operations-member-${ids.member}@local.test`,
            ids.certifiedNoTeam, `platform-operations-certified-${ids.certifiedNoTeam}@local.test`,
            ids.lft, `platform-operations-lft-${ids.lft}@local.test`,
            ids.merged, `platform-operations-merged-${ids.merged}@local.test`,
            recent, oldTenDays, oldThirtyOneDays,
          ],
        );
        await fixture.query(
          `INSERT INTO teams (id, slug, name, status, creator_user_id, captain_user_id, disbanded_at, created_at, updated_at)
           VALUES ($1, $2, 'Platform Operations Active Team', 'active', $3, $3, NULL, $5, $5),
                  ($4, $6, 'Platform Operations Disbanded Team', 'disbanded', $3, $3, $7, $8, $8)`,
          [ids.activeTeam, `platform-operations-active-${ids.activeTeam}`, ids.captain, ids.disbandedTeam, recent, `platform-operations-disbanded-${ids.disbandedTeam}`, endedAt, endedStartedAt],
        );
        await fixture.query(
          `INSERT INTO team_captain_changes (id, team_id, from_user_id, to_user_id, changed_at, changed_by_actor_id)
           VALUES ($1, $3, NULL, $2, $5, 'platform-operations-test'),
                  ($4, $6, NULL, $2, $7, 'platform-operations-test')`,
          [ids.activeCaptainChange, ids.captain, ids.activeTeam, ids.disbandedCaptainChange, recent, ids.disbandedTeam, endedStartedAt],
        );
        await fixture.query(
          `INSERT INTO team_name_changes (id, team_id, old_name, new_name, changed_at, changed_by_actor_id)
           VALUES ($1, $2, NULL, 'Platform Operations Active Team', $4, 'platform-operations-test'),
                  ($3, $5, NULL, 'Platform Operations Disbanded Team', $6, 'platform-operations-test')`,
          [ids.activeNameChange, ids.activeTeam, ids.disbandedNameChange, recent, ids.disbandedTeam, endedStartedAt],
        );
        await fixture.query(
          `INSERT INTO team_memberships (id, team_id, user_id, status, started_at, ended_at, ended_reason, invited_by_user_id, created_at, updated_at)
           VALUES ($1, $5, $2, 'active', $7, NULL, NULL, $2, $7, $7),
                  ($3, $5, $4, 'benched', $7, NULL, NULL, $2, $7, $7),
                  ($6, $5, $8, 'active', $7, NULL, NULL, $2, $7, $7),
                  ($9, $5, $10, 'left', $11, $12, 'left', $2, $11, $12)`,
          [ids.captainMembership, ids.captain, ids.memberMembership, ids.member, ids.activeTeam, ids.mergedMembership, ids.merged, ids.endedMembership, ids.lft, endedStartedAt, endedAt],
        );
        await fixture.query(
          `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, status, reviewed_by, submitted_at, reviewed_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'enrolled', 'institutional_email', 'approved', 'platform-operations-test', $5, $6, $5, $6),
                  ($4, $7, $3, 'graduated', 'institutional_email', 'approved', 'platform-operations-test', $5, $6, $5, $6)`,
          [ids.captainVerification, ids.captain, ids.institution, ids.certifiedVerification, recent, recent, ids.certifiedNoTeam],
        );
        await fixture.query(
          `INSERT INTO user_sessions (user_id, last_active_at)
           VALUES ($1, $6), ($2, $7), ($3, $8), ($4, $9), ($5, $6)`,
          [ids.captain, ids.member, ids.certifiedNoTeam, ids.lft, ids.merged, new Date(now.getTime() - 60 * 60 * 1000), new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)],
        );
        await fixture.query(
          `INSERT INTO recruitment_intents (id, kind, team_id, user_id, status, expires_at, created_at, updated_at)
           VALUES ($1, 'team_recruiting', $5, NULL, 'open', $6, $7, $7),
                  ($2, 'player_lft', NULL, $3, 'open', $6, $7, $7),
                  ($4, 'player_lft', NULL, $8, 'open', $6, $7, $7),
                  ($9, 'team_recruiting', $10, NULL, 'open', $6, $7, $7)`,
          [ids.teamIntent, ids.lftIntent, ids.lft, ids.mergedIntent, ids.activeTeam, new Date(now.getTime() + 24 * 60 * 60 * 1000), recent, ids.merged, ids.disbandedTeamIntent, ids.disbandedTeam],
        );
        await fixture.query("COMMIT");
      } catch (error) {
        await fixture.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        fixture.release();
      }

      const after = await getPlatformOperationsOverview(now);
      expect(after.population.activeUsers - before.population.activeUsers).toBe(4);
      expect(after.population.activeUsers24h - before.population.activeUsers24h).toBe(1);
      expect(after.population.activeUsers7d - before.population.activeUsers7d).toBe(2);
      expect(after.population.activeUsers30d - before.population.activeUsers30d).toBe(3);
      expect(after.population.certifiedUsers - before.population.certifiedUsers).toBe(2);
      expect(after.population.activeTeams - before.population.activeTeams).toBe(1);
      expect(after.playerPool.currentTeamUsers - before.playerPool.currentTeamUsers).toBe(2);
      expect(after.playerPool.certifiedWithoutTeam - before.playerPool.certifiedWithoutTeam).toBe(1);
      expect(after.playerPool.teamWithoutCertification - before.playerPool.teamWithoutCertification).toBe(1);
      expect(after.playerPool.publicPlayerLft - before.playerPool.publicPlayerLft).toBe(1);
      expect(after.playerPool.publicTeamRecruiting - before.playerPool.publicTeamRecruiting).toBe(1);
      expect(after.teams.totalMemberCount - before.teams.totalMemberCount).toBe(2);
      expect(after.teams.sizeDistribution.find((bucket) => bucket.key === "2")?.count).toBe(
        (before.teams.sizeDistribution.find((bucket) => bucket.key === "2")?.count ?? 0) + 1,
      );

      const beforeGrowth = before.growth.find((day) => day.date === "2026-09-15");
      const afterGrowth = after.growth.find((day) => day.date === "2026-09-15");
      expect(afterGrowth).toBeDefined();
      expect(afterGrowth!.newActiveUsers - (beforeGrowth?.newActiveUsers ?? 0)).toBe(2);
      expect(afterGrowth!.newEducationApprovals - (beforeGrowth?.newEducationApprovals ?? 0)).toBe(2);
      expect(afterGrowth!.newActiveTeams - (beforeGrowth?.newActiveTeams ?? 0)).toBe(1);
      expect(afterGrowth!.newActiveMemberships - (beforeGrowth?.newActiveMemberships ?? 0)).toBe(2);
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SET LOCAL session_replication_role = replica");
        await cleanup.query("DELETE FROM recruitment_intents WHERE id IN ($1, $2, $3, $4)", [ids.teamIntent, ids.lftIntent, ids.mergedIntent, ids.disbandedTeamIntent]);
        await cleanup.query("DELETE FROM education_verifications WHERE id IN ($1, $2)", [ids.captainVerification, ids.certifiedVerification]);
        await cleanup.query("DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
        await cleanup.query("DELETE FROM team_memberships WHERE id = ANY($1::uuid[])", [[ids.captainMembership, ids.memberMembership, ids.mergedMembership, ids.endedMembership]]);
        await cleanup.query("DELETE FROM team_captain_changes WHERE id IN ($1, $2)", [ids.activeCaptainChange, ids.disbandedCaptainChange]);
        await cleanup.query("DELETE FROM team_name_changes WHERE id IN ($1, $2)", [ids.activeNameChange, ids.disbandedNameChange]);
        await cleanup.query("DELETE FROM teams WHERE id = ANY($1::uuid[])", [teamIds]);
        await cleanup.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
        await cleanup.query("DELETE FROM institutions WHERE id = $1", [ids.institution]);
        await cleanup.query("COMMIT");
      } catch (error) {
        await cleanup.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        cleanup.release();
      }
      await pool.end();
    }
  });
});
