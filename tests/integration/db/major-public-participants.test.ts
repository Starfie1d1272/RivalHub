import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

import { createMajorDefaultCapabilities } from "../../../src/lib/competition/templates";
import {
  getMajorPublicParticipantProjection,
  getMajorPublicParticipantTeam,
  type MajorPublicParticipantSeason,
} from "../../../src/lib/major/public-participants";
import { checkStandardMajorCapabilities } from "../../../src/lib/competition/definition";
import { createLocalPool } from "./harness/database";

const ACTOR = "major-public-participants-integration";

interface EntryFixture {
  entryId: string;
  revisionId: string;
  userIds: string[];
  participantIds: string[];
}

interface Fixture {
  season: MajorPublicParticipantSeason;
  entries: EntryFixture[];
  entrantIds: string[];
  eventRosterIds: string[];
  userIds: string[];
}

async function insertFixture(pool: Pool): Promise<Fixture> {
  const client = await pool.connect();
  const capabilities = createMajorDefaultCapabilities();
  const entrantCapacity = checkStandardMajorCapabilities(capabilities).entrantCapacity;
  const seasonId = randomUUID();
  const seasonSlug = `major-public-participants-${seasonId}`;
  const entries = Array.from({ length: entrantCapacity + 1 }, () => ({
    entryId: randomUUID(),
    revisionId: randomUUID(),
    userIds: Array.from({ length: 6 }, () => randomUUID()),
    participantIds: [] as string[],
  }));
  const entrantIds = entries.slice(0, entrantCapacity).map(() => randomUUID());
  const eventRosterIds = entries.slice(0, entrantCapacity).map(() => randomUUID());
  const userIds = entries.flatMap((entry) => entry.userIds);

  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      `INSERT INTO seasons (
         id, slug, name, kind, competition_template, status, registration_mode,
         has_captain_voting, has_draft, stage_plan, registration_config,
         team_registration_config, affiliation_rules, min_team_size, max_team_size,
         starter_count, positions
       ) VALUES ($1, $2, 'Major public participant integration', 'Major', 'major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId,
        seasonSlug,
        capabilities.registrationMode,
        capabilities.hasCaptainVoting,
        capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan),
        JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig),
        JSON.stringify(capabilities.affiliationRules),
        capabilities.minTeamSize,
        capabilities.maxTeamSize,
        capabilities.starterCount,
        capabilities.positions,
      ],
    );

    for (const [entryIndex, entry] of entries.entries()) {
      for (const [userIndex, userId] of entry.userIds.entries()) {
        await client.query(
          `INSERT INTO users (id, email, display_name, perfect_name)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            `major-public-${entryIndex}-${userIndex}-${seasonId}@local.test`,
            `公开选手 ${entryIndex}-${userIndex}`,
            `完美选手 ${entryIndex}-${userIndex}`,
          ],
        );
      }

      await client.query(
        `INSERT INTO competition_entries (
           id, competition_id, source, name, representative_user_id,
           current_roster_revision_id, approved_roster_revision_id, registration_status
         ) VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')`,
        [entry.entryId, seasonId, `审核队伍 ${entryIndex}`, entry.userIds[0], entry.revisionId],
      );
      await client.query(
        `INSERT INTO competition_entry_representative_changes (
           entry_id, from_user_id, to_user_id, changed_by_actor_id
         ) VALUES ($1, NULL, $2, $3)`,
        [entry.entryId, entry.userIds[0], ACTOR],
      );
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (
           id, entry_id, revision_number, status, created_by, approved_at
         ) VALUES ($1, $2, 1, 'approved', $3, now())`,
        [entry.revisionId, entry.entryId, ACTOR],
      );
      for (const userId of entry.userIds) {
        const participantId = randomUUID();
        entry.participantIds.push(participantId);
        await client.query(
          `INSERT INTO competition_entry_participants (
             id, entry_id, user_id, status, confirmed_at, invited_by_user_id
           ) VALUES ($1, $2, $3, 'confirmed', now(), $4)`,
          [participantId, entry.entryId, userId, entry.userIds[0]],
        );
      }
      for (const [userIndex, userId] of entry.userIds.slice(0, 5).entries()) {
        await client.query(
          `INSERT INTO competition_entry_roster_members (
             id, revision_id, participant_id, user_id, is_primary_starter
           ) VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), entry.revisionId, entry.participantIds[userIndex], userId, userIndex < 5],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return {
    season: {
      id: seasonId,
      slug: seasonSlug,
      name: "Major public participant integration",
      status: "registration",
      competitionTemplate: "major",
      registrationMode: capabilities.registrationMode,
      hasCaptainVoting: capabilities.hasCaptainVoting,
      hasDraft: capabilities.hasDraft,
      hasCommunityAwards: capabilities.hasCommunityAwards,
      stagePlan: capabilities.stagePlan,
      registrationConfig: capabilities.registrationConfig,
      teamRegistrationConfig: capabilities.teamRegistrationConfig,
      affiliationRules: capabilities.affiliationRules,
      minTeamSize: capabilities.minTeamSize,
      maxTeamSize: capabilities.maxTeamSize,
      starterCount: capabilities.starterCount,
      positions: capabilities.positions,
    },
    entries,
    entrantIds,
    eventRosterIds,
    userIds,
  };
}

async function makeOfficialFacts(pool: Pool, fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, entry] of fixture.entries.slice(0, fixture.entrantIds.length).entries()) {
      await client.query(
        `INSERT INTO major_tournament_entrants (id, season_id, competition_entry_id)
         VALUES ($1, $2, $3)`,
        [fixture.entrantIds[index], fixture.season.id, entry.entryId],
      );
      await client.query(
        `INSERT INTO event_rosters (
           id, entry_id, source_roster_revision_id, status,
           confirmed_at, confirmed_by
         ) VALUES ($1, $2, $3, 'confirmed', now(), $4)`,
        [fixture.eventRosterIds[index], entry.entryId, entry.revisionId, ACTOR],
      );
      for (const [userIndex, userId] of entry.userIds.slice(1, 6).entries()) {
        await client.query(
          `INSERT INTO event_roster_members (
             id, event_roster_id, participant_id, user_id, is_primary_starter
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            fixture.eventRosterIds[index],
            entry.participantIds[userIndex + 1],
            userId,
            userIndex < 5,
          ],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function addSeedFacts(pool: Pool, fixture: Fixture, complete: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO major_prestart_states (
         id, season_id, seeds_confirmed_at, seeds_confirmed_by
       ) VALUES ($1, $2, now(), $3)
       ON CONFLICT (season_id) DO NOTHING`,
      [randomUUID(), fixture.season.id, ACTOR],
    );
    const count = complete ? fixture.entrantIds.length : 1;
    for (let index = 0; index < count; index += 1) {
      await client.query(
        `INSERT INTO major_tournament_seeds (id, season_id, tournament_entrant_id, seed)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (season_id, tournament_entrant_id) DO NOTHING`,
        [randomUUID(), fixture.season.id, fixture.entrantIds[index], index + 1],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function freezeOfficialFacts(pool: Pool, fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE event_rosters
       SET status = 'frozen', frozen_at = now(), frozen_by = $2
       WHERE entry_id = ANY($1::uuid[])`,
      [fixture.entries.slice(0, fixture.entrantIds.length).map((entry) => entry.entryId), ACTOR],
    );
    await client.query(
      `UPDATE major_prestart_states
       SET entrants_locked_at = now(), entrants_locked_by = $2
       WHERE season_id = $1`,
      [fixture.season.id, ACTOR],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(pool: Pool, fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.season.id]);
    await client.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [fixture.season.id]);
    await client.query(
      "DELETE FROM event_roster_members WHERE event_roster_id = ANY($1::uuid[])",
      [fixture.eventRosterIds],
    );
    await client.query("DELETE FROM event_rosters WHERE entry_id = ANY($1::uuid[])", [fixture.entries.map((entry) => entry.entryId)]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.season.id]);
    await client.query("DELETE FROM competition_entry_roster_members WHERE revision_id = ANY($1::uuid[])", [fixture.entries.map((entry) => entry.revisionId)]);
    await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [fixture.entries.map((entry) => entry.entryId)]);
    await client.query("DELETE FROM competition_entry_participants WHERE entry_id = ANY($1::uuid[])", [fixture.entries.map((entry) => entry.entryId)]);
    await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[])", [fixture.entries.map((entry) => entry.entryId)]);
    await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.season.id]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.season.id]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

describe("Major public participant read model PostgreSQL integration", () => {
  it("switches candidate/current/frozen facts and fails closed for partial seeds", async () => {
    const pool = createLocalPool({ max: 2 });
    const fixture = await insertFixture(pool);
    try {
      const candidate = await getMajorPublicParticipantProjection(fixture.season);
      expect(candidate.phase).toBe("approved_candidates");
      expect(candidate.teams).toHaveLength(33);
      expect(candidate.players).toHaveLength(33 * 5);
      expect(candidate.presentation.teamCollectionLabel).toBe("已通过报名审核的队伍");
      expect(candidate.teams.every((team) => team.rosterLabel === "已审核报名名单")).toBe(true);

      const candidateDetail = await getMajorPublicParticipantTeam(fixture.season, fixture.entries[32]!.entryId);
      expect(candidateDetail?.participation).toMatchObject({
        label: "已通过报名审核",
        detail: "已通过报名审核，正赛资格待确认。",
      });
      expect(candidateDetail?.rosterLabel).toBe("已审核报名名单");

      await makeOfficialFacts(pool, fixture);
      const final = await getMajorPublicParticipantProjection(fixture.season);
      expect(final.phase).toBe("final_entrants");
      expect(final.teams).toHaveLength(32);
      expect(final.teams.some((team) => team.entry.id === fixture.entries[32]?.entryId)).toBe(false);
      expect(final.players).toHaveLength(32 * 5);
      expect(final.teams.every((team) => team.rosterLabel === "当前参赛名单")).toBe(true);
      expect(final.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId)?.roster.some((member) => member.name === "公开选手 0-1")).toBe(true);

      await addSeedFacts(pool, fixture, false);
      const partialSeeds = await getMajorPublicParticipantProjection(fixture.season);
      expect(partialSeeds.teams.every((team) => team.seed === null && team.seedPresentation?.label === "种子待确认")).toBe(true);

      await addSeedFacts(pool, fixture, true);
      const confirmedSeeds = await getMajorPublicParticipantProjection(fixture.season);
      expect(confirmedSeeds.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId)?.seed).toBe(1);
      expect(confirmedSeeds.teams.find((team) => team.entry.id === fixture.entries[31]?.entryId)?.seed).toBe(32);

      await freezeOfficialFacts(pool, fixture);
      const frozen = await getMajorPublicParticipantProjection(fixture.season);
      expect(frozen.phase).toBe("rosters_frozen");
      expect(frozen.teams.every((team) => team.rosterLabel === "最终参赛名单")).toBe(true);
      expect(frozen.presentation.playerDescription).toBe("以下选手来自本届最终参赛名单。");

      const frozenTeam = frozen.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId);
      expect(frozenTeam?.roster.find((member) => member.userId === fixture.entries[0]?.userIds[1])?.isStarter).toBe(true);
    } finally {
      await cleanupFixture(pool, fixture);
      await pool.end();
    }
  });
});
