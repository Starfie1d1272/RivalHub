import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  grantCompetitionEntryRestrictionOverrideInTx,
  revokeCompetitionEntryRestrictionOverrideInTx,
  reviewCompetitionEntryInTx,
  submitCompetitionEntryInTx,
} from "../../../src/lib/competition-entries/commands";
import { loadActiveRestrictionOverridesInTx } from "../../../src/lib/competition-entries/restriction-overrides";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { BUILT_IN_COMPETITIVE_PLATFORMS } from "../../../src/lib/competitive/builtins";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

async function expectAppError(work: () => Promise<unknown>, code: ErrorCode): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError && error.code === code) return error;
    throw error;
  }
  throw new Error(`预期 AppError(${code})，但操作成功。`);
}

describe("competition entry qualification restriction overrides PostgreSQL", () => {
  it("only releases the current waivable finding and keeps revision/audit history durable", async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
    const database = drizzle(pool, { schema });
    const ids = {
      season: randomUUID(),
      home: randomUUID(),
      external: randomUUID(),
      entry: randomUUID(),
      revision: randomUUID(),
      nextRevision: randomUUID(),
      homeParticipant: randomUUID(),
      externalParticipant: randomUUID(),
      homeRosterMember: randomUUID(),
      externalRosterMember: randomUUID(),
      homeHistorical: randomUUID(),
      homePrevious: randomUUID(),
      homeCurrent: randomUUID(),
      externalHistorical: randomUUID(),
      externalPrevious: randomUUID(),
      externalCurrent: randomUUID(),
    };
    const profile = {
      platform: "perfect_world",
      currentSeasonKey: "2026s2",
      previousSeasonKey: "2026s1",
      rankOrder: BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world.ranks.map((rank) => rank.rankKey),
      externalStrengthMaxStarGap: 3,
    };
    const teamConfig = {
      allowExternal: true,
      graduateCountsAsHome: true,
      minHomeMembers: 0,
      minEnrolledMembers: 0,
      maxExternalMembers: 99,
      requirePositions: false,
      maxPerPositionPerTeam: 2,
      captainCanKick: true,
      captainCanTransfer: true,
      lockAfterRegistration: true,
      requireUniqueTeamName: true,
      requireTeamLogo: false,
      requireCompetitiveProfile: true,
      competitiveProfile: profile,
    };
    const affiliationRules = [{
      institutionCode: "4132010284",
      eligibleAcademicStatuses: ["enrolled", "graduated"],
      minRosterMembers: 1,
      minStartingMembers: 0,
    }];
    const client = await pool.connect();
    try {
      const institutionRows = await client.query<{ id: string; code: string }>(
        "SELECT id, moe_institution_code AS code FROM institutions WHERE moe_institution_code IN ('4132010284', '4111010001')",
      );
      const institutionByCode = new Map(institutionRows.rows.map((row) => [row.code, row.id]));
      const homeInstitutionId = institutionByCode.get("4132010284");
      const externalInstitutionId = institutionByCode.get("4111010001");
      if (!homeInstitutionId || !externalInstitutionId) throw new Error("override fixture 缺少学校目录基线。");

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO seasons (
          id, slug, name, kind, competition_template, status, registration_mode,
          has_captain_voting, has_draft, team_registration_config, affiliation_rules,
          min_team_size, max_team_size, starter_count
        ) VALUES ($1, $2, 'Qualification Override Fixture', 'Major', 'major', 'registration', 'team', false, false, $3::json, $4::json, 2, 2, 2)`,
        [ids.season, `local-override-${ids.season}`, JSON.stringify(teamConfig), JSON.stringify(affiliationRules)],
      );
      await client.query(
        `INSERT INTO users (id, email, email_verified_at, display_name, perfect_name, steam64, qq)
         VALUES ($1, $2, now(), 'Home player', 'Home Perfect', '76561198000000001', '100000001'),
                ($3, $4, now(), 'External player', 'External Perfect', '76561198000000002', '100000002')`,
        [ids.home, `home-${ids.home}@local.test`, ids.external, `external-${ids.external}@local.test`],
      );
      await client.query(
        `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'enrolled', 'manual_other', 'approved', 'local-admin', now()),
                ($3, $4, 'enrolled', 'manual_other', 'approved', 'local-admin', now())`,
        [ids.home, homeInstitutionId, ids.external, externalInstitutionId],
      );
      await client.query(
        `INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating, stars)
         VALUES ($1, $2, 'perfect_world', 'historical_peak', NULL, '钻石S', 1800, 35),
                ($3, $2, 'perfect_world', 'season_peak', '2026s1', 'A++', 1700, NULL),
                ($4, $2, 'perfect_world', 'season_peak', '2026s2', 'A++', 1750, NULL),
                ($5, $6, 'perfect_world', 'historical_peak', NULL, '钻石S', 1900, 40),
                ($7, $6, 'perfect_world', 'season_peak', '2026s1', 'A++', 1800, NULL),
                ($8, $6, 'perfect_world', 'season_peak', '2026s2', 'A++', 1850, NULL)`,
        [ids.homeHistorical, ids.home, ids.homePrevious, ids.homeCurrent, ids.externalHistorical, ids.external, ids.externalPrevious, ids.externalCurrent],
      );
      await client.query(
        `INSERT INTO competition_entries (id, competition_id, source, name, logo_url, representative_user_id, perfect_team_id, current_roster_revision_id, registration_status)
         VALUES ($1, $2, 'event_native', 'Override Fixture Entry', NULL, $3, 'override-fixture', $4, 'draft')`,
        [ids.entry, ids.season, ids.home, ids.revision],
      );
      await client.query(
        "INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')",
        [ids.entry, ids.home],
      );
      await client.query(
        `INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id)
         VALUES ($1, $3, $4, 'confirmed', now(), $4), ($2, $3, $5, 'confirmed', now(), $4)`,
        [ids.homeParticipant, ids.externalParticipant, ids.entry, ids.home, ids.external],
      );
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by)
         VALUES ($1, $2, 1, 'draft', 'local-test')`,
        [ids.revision, ids.entry],
      );
      await client.query(
        `INSERT INTO competition_entry_roster_members (id, revision_id, participant_id, user_id, is_primary_starter)
         VALUES ($1, $3, $4, $5, true), ($2, $3, $6, $7, true)`,
        [ids.homeRosterMember, ids.externalRosterMember, ids.revision, ids.homeParticipant, ids.home, ids.externalParticipant, ids.external],
      );
      await client.query("COMMIT");

      await database.transaction((tx) => submitCompetitionEntryInTx(tx, {
        entryId: ids.entry,
        userId: ids.home,
        actorId: "local-admin",
      }));

      await expectAppError(
        () => database.transaction((tx) => reviewCompetitionEntryInTx(tx, { entryId: ids.entry, decision: "approved", actorId: "local-admin" })),
        ErrorCode.VALIDATION_FAILED,
      );

      await expectAppError(
        () => database.transaction(async (tx) => {
          await tx.execute(sql`UPDATE competitive_rank_facts SET stars = NULL WHERE id = ${ids.homeHistorical}`);
          return grantCompetitionEntryRestrictionOverrideInTx(tx, {
            entryId: ids.entry,
            restrictionCode: "competitive_profile_incomplete",
            reason: "不应允许用解除限制代替补齐缺失星数。",
            actorId: "local-admin",
          });
        }),
        ErrorCode.VALIDATION_FAILED,
      );
      await client.query("UPDATE competitive_rank_facts SET stars = 35 WHERE id = $1", [ids.homeHistorical]);

      await expectAppError(
        () => database.transaction((tx) => grantCompetitionEntryRestrictionOverrideInTx(tx, {
          entryId: ids.entry,
          restrictionCode: "external_strength_gap",
          reason: "   ",
          actorId: "local-admin",
        })),
        ErrorCode.VALIDATION_FAILED,
      );

      const firstGrant = await database.transaction((tx) => grantCompetitionEntryRestrictionOverrideInTx(tx, {
        entryId: ids.entry,
        restrictionCode: "external_strength_gap",
        reason: "本次赛事已完成外校阵容事实核验，责任管理员明确解除该政策限制。",
        actorId: "local-admin",
      }));
      expect(firstGrant.alreadyGranted).toBe(false);
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, origin, created_by)
         VALUES ($1, $2, 2, 'draft', 'self_roster_change', 'local-test')`,
        [ids.nextRevision, ids.entry],
      );
      const nextRevisionOverrides = await database.transaction((tx) => loadActiveRestrictionOverridesInTx(tx, {
        competitionId: ids.season,
        entryIds: [ids.entry],
        rosterRevisionIds: [ids.nextRevision],
      }));
      expect(nextRevisionOverrides).toEqual([]);
      await database.transaction((tx) => revokeCompetitionEntryRestrictionOverrideInTx(tx, {
        entryId: ids.entry,
        restrictionCode: "external_strength_gap",
        actorId: "local-admin-2",
      }));
      const secondGrant = await database.transaction((tx) => grantCompetitionEntryRestrictionOverrideInTx(tx, {
        entryId: ids.entry,
        restrictionCode: "external_strength_gap",
        reason: "重新核对当前 roster revision 后，明确解除该政策限制。",
        actorId: "local-admin-3",
      }));
      expect(secondGrant.alreadyGranted).toBe(false);

      await database.transaction((tx) => reviewCompetitionEntryInTx(tx, {
        entryId: ids.entry,
        decision: "approved",
        actorId: "local-admin-3",
      }));

      const persisted = await client.query<{ status: string; revision_status: string; active_overrides: string; grant_audits: string; revoke_audits: string }>(
        `SELECT entry.registration_status AS status,
                revision.status AS revision_status,
                (SELECT count(*) FROM competition_entry_restriction_overrides override
                 WHERE override.entry_id = entry.id AND override.revoked_at IS NULL)::text AS active_overrides,
                (SELECT count(*) FROM audit_logs audit
                 WHERE audit.target_id = entry.id::text AND audit.action = 'competition_entry.restriction_override.grant')::text AS grant_audits,
                (SELECT count(*) FROM audit_logs audit
                 WHERE audit.target_id = entry.id::text AND audit.action = 'competition_entry.restriction_override.revoke')::text AS revoke_audits
         FROM competition_entries entry
         JOIN competition_entry_roster_revisions revision ON revision.id = entry.current_roster_revision_id
         WHERE entry.id = $1`,
        [ids.entry],
      );
      expect(persisted.rows[0]).toMatchObject({
        status: "approved",
        revision_status: "approved",
        active_overrides: "1",
        grant_audits: "2",
        revoke_audits: "1",
      });
      const overrides = await client.query<{ roster_revision_id: string; revoked_at: Date | null; reason: string }>(
        `SELECT roster_revision_id, revoked_at, reason
         FROM competition_entry_restriction_overrides
         WHERE entry_id = $1`,
        [ids.entry],
      );
      expect(overrides.rows).toHaveLength(2);
      expect(overrides.rows.every((row) => row.roster_revision_id === ids.revision)).toBe(true);
      const revoked = overrides.rows.find((row) => row.revoked_at !== null);
      const active = overrides.rows.find((row) => row.revoked_at === null);
      expect(revoked).toBeDefined();
      expect(active?.reason).toContain("重新核对");
      const audits = await client.query<{ action: string; meta: { rosterRevisionId?: string; restrictionCode?: string; reason?: string; findingSnapshot?: unknown } }>(
        `SELECT action, meta
         FROM audit_logs
         WHERE target_id = $1 AND target_type = 'competition_entry'
           AND action IN ('competition_entry.restriction_override.grant', 'competition_entry.restriction_override.revoke')
         ORDER BY created_at, id`,
        [ids.entry],
      );
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.every((audit) =>
        audit.meta.rosterRevisionId === ids.revision &&
        audit.meta.restrictionCode === "external_strength_gap" &&
        typeof audit.meta.reason === "string" &&
        audit.meta.findingSnapshot !== undefined,
      )).toBe(true);
    } finally {
      await client.query("BEGIN").catch(() => {});
      await client.query("DELETE FROM audit_logs WHERE season_id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM competition_entry_restriction_overrides WHERE entry_id = $1", [ids.entry]).catch(() => {});
      await client.query("DELETE FROM competition_entry_submissions WHERE entry_id = $1", [ids.entry]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_members WHERE revision_id = $1", [ids.revision]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE id = $1", [ids.nextRevision]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE id = $1", [ids.revision]).catch(() => {});
      await client.query("DELETE FROM competition_entry_participants WHERE entry_id = $1", [ids.entry]).catch(() => {});
      await client.query("DELETE FROM competition_entries WHERE id = $1", [ids.entry]).catch(() => {});
      await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [[ids.home, ids.external]]).catch(() => {});
      await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [[ids.home, ids.external]]).catch(() => {});
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.home, ids.external]]).catch(() => {});
      await client.query("COMMIT").catch(() => client.query("ROLLBACK").catch(() => {}));
      client.release();
      await pool.end();
    }
  });
});
