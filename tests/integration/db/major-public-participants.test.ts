import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

import { createMajorDefaultCapabilities } from "../../../src/lib/competition/templates";
import {
  getMajorPublicParticipantProjection,
  getMajorPublicParticipantSummary,
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
  for (const entry of entries) entry.participantIds = entry.userIds.map(() => randomUUID());
  const userRows = entries.flatMap((entry, entryIndex) => entry.userIds.map((userId, userIndex) => ({
    userId,
    email: `major-public-${entryIndex}-${userIndex}-${seasonId}@local.test`,
    displayName: `公开选手 ${entryIndex}-${userIndex}`,
    perfectName: `完美选手 ${entryIndex}-${userIndex}`,
  })));
  const participantRows = entries.flatMap((entry) => entry.userIds.map((userId, userIndex) => ({
    participantId: entry.participantIds[userIndex]!,
    entryId: entry.entryId,
    userId,
    invitedByUserId: entry.userIds[0]!,
  })));
  const rosterRows = entries.flatMap((entry) => entry.userIds.slice(0, 5).map((userId, userIndex) => ({
    id: randomUUID(),
    revisionId: entry.revisionId,
    participantId: entry.participantIds[userIndex]!,
    userId,
  })));

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

    await client.query(
      `INSERT INTO users (id, email, display_name, perfect_name)
       SELECT user_id, email, display_name, perfect_name
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[])
       AS rows(user_id, email, display_name, perfect_name)`,
      [
        userRows.map((row) => row.userId),
        userRows.map((row) => row.email),
        userRows.map((row) => row.displayName),
        userRows.map((row) => row.perfectName),
      ],
    );
    await client.query(
      `INSERT INTO competition_entries (
         id, competition_id, source, name, representative_user_id,
         current_roster_revision_id, approved_roster_revision_id, registration_status
       )
       SELECT entry_id, competition_id, 'event_native', name, representative_user_id,
         revision_id, revision_id, 'approved'
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::uuid[])
       AS rows(entry_id, competition_id, name, representative_user_id, revision_id)`,
      [
        entries.map((entry) => entry.entryId),
        entries.map(() => seasonId),
        entries.map((_, index) => `审核队伍 ${index}`),
        entries.map((entry) => entry.userIds[0]),
        entries.map((entry) => entry.revisionId),
      ],
    );
    await client.query(
      `INSERT INTO competition_entry_representative_changes (
         entry_id, from_user_id, to_user_id, changed_by_actor_id
       )
       SELECT entry_id, NULL, representative_user_id, $3
       FROM unnest($1::uuid[], $2::uuid[])
       AS rows(entry_id, representative_user_id)`,
      [entries.map((entry) => entry.entryId), entries.map((entry) => entry.userIds[0]), ACTOR],
    );
    await client.query(
      `INSERT INTO competition_entry_roster_revisions (
         id, entry_id, revision_number, status, created_by, approved_at
       )
       SELECT revision_id, entry_id, 1, 'approved', $3, now()
       FROM unnest($1::uuid[], $2::uuid[])
       AS rows(revision_id, entry_id)`,
      [entries.map((entry) => entry.revisionId), entries.map((entry) => entry.entryId), ACTOR],
    );
    await client.query(
      `INSERT INTO competition_entry_participants (
         id, entry_id, user_id, status, confirmed_at, invited_by_user_id
       )
       SELECT participant_id, entry_id, user_id, 'confirmed', now(), invited_by_user_id
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[])
       AS rows(participant_id, entry_id, user_id, invited_by_user_id)`,
      [
        participantRows.map((row) => row.participantId),
        participantRows.map((row) => row.entryId),
        participantRows.map((row) => row.userId),
        participantRows.map((row) => row.invitedByUserId),
      ],
    );
    await client.query(
      `INSERT INTO competition_entry_roster_members (
         id, revision_id, participant_id, user_id, is_primary_starter
       )
       SELECT id, revision_id, participant_id, user_id, true
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[])
       AS rows(id, revision_id, participant_id, user_id)`,
      [
        rosterRows.map((row) => row.id),
        rosterRows.map((row) => row.revisionId),
        rosterRows.map((row) => row.participantId),
        rosterRows.map((row) => row.userId),
      ],
    );

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
  const officialEntries = fixture.entries.slice(0, fixture.entrantIds.length);
  const rosterRows = officialEntries.flatMap((entry, index) => entry.userIds.slice(1, 6).map((userId, userIndex) => ({
    id: randomUUID(),
    eventRosterId: fixture.eventRosterIds[index]!,
    participantId: entry.participantIds[userIndex + 1]!,
    userId,
  })));
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO major_tournament_entrants (id, season_id, competition_entry_id)
       SELECT entrant_id, season_id, entry_id
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[])
       AS rows(entrant_id, season_id, entry_id)`,
      [
        fixture.entrantIds,
        fixture.entrantIds.map(() => fixture.season.id),
        officialEntries.map((entry) => entry.entryId),
      ],
    );
    await client.query(
      `INSERT INTO event_rosters (
         id, entry_id, source_roster_revision_id, status,
         confirmed_at, confirmed_by
       )
       SELECT roster_id, entry_id, revision_id, 'confirmed', now(), $4
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[])
       AS rows(roster_id, entry_id, revision_id)`,
      [
        fixture.eventRosterIds,
        officialEntries.map((entry) => entry.entryId),
        officialEntries.map((entry) => entry.revisionId),
        ACTOR,
      ],
    );
    await client.query(
      `INSERT INTO event_roster_members (
         id, event_roster_id, participant_id, user_id, is_primary_starter
       )
       SELECT id, event_roster_id, participant_id, user_id, true
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[])
       AS rows(id, event_roster_id, participant_id, user_id)`,
      [
        rosterRows.map((row) => row.id),
        rosterRows.map((row) => row.eventRosterId),
        rosterRows.map((row) => row.participantId),
        rosterRows.map((row) => row.userId),
      ],
    );
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
    const seedRows = fixture.entrantIds.slice(0, count).map((entrantId, index) => ({
      id: randomUUID(),
      seasonId: fixture.season.id,
      entrantId,
      seed: index + 1,
    }));
    await client.query(
      `INSERT INTO major_tournament_seeds (id, season_id, tournament_entrant_id, seed)
       SELECT id, season_id, entrant_id, seed
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::int[])
       AS rows(id, season_id, entrant_id, seed)
       ON CONFLICT (season_id, tournament_entrant_id) DO NOTHING`,
      [
        seedRows.map((row) => row.id),
        seedRows.map((row) => row.seasonId),
        seedRows.map((row) => row.entrantId),
        seedRows.map((row) => row.seed),
      ],
    );
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
    await client.query(
      `UPDATE users
       SET status = 'merged', merged_into_user_id = $2, merged_at = now()
       WHERE id = $1`,
      [fixture.entries[0]!.userIds[1], fixture.entries[0]!.userIds[0]],
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
      const candidate = await getMajorPublicParticipantSummary(fixture.season);
      expect(candidate.phase).toBe("approved_candidates");
      expect(candidate.teams).toHaveLength(33);
      expect(candidate.playerCount).toBe(33 * 5);
      expect(candidate.presentation.teamCollectionLabel).toBe("已通过报名审核的队伍");
      expect(candidate.teams.every((team) => team.rosterLabel === "已审核报名名单")).toBe(true);

      const candidatePlayers = await getMajorPublicParticipantProjection(fixture.season);
      expect(candidatePlayers.players).toHaveLength(33 * 5);

      const candidateDetail = await getMajorPublicParticipantTeam(fixture.season, fixture.entries[32]!.entryId);
      expect(candidateDetail?.participation).toMatchObject({
        label: "已通过报名审核",
        detail: "已通过报名审核，正赛资格待确认。",
      });
      expect(candidateDetail?.rosterLabel).toBe("已审核报名名单");

      await makeOfficialFacts(pool, fixture);
      const final = await getMajorPublicParticipantSummary(fixture.season);
      expect(final.phase).toBe("final_entrants");
      expect(final.teams).toHaveLength(32);
      expect(final.teams.some((team) => team.entry.id === fixture.entries[32]?.entryId)).toBe(false);
      expect(final.playerCount).toBe(32 * 5);
      expect(final.teams.every((team) => team.rosterLabel === "当前参赛名单")).toBe(true);
      expect(final.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId)?.roster.some((member) => member.name === "公开选手 0-1")).toBe(true);

      await addSeedFacts(pool, fixture, false);
      const partialSeeds = await getMajorPublicParticipantSummary(fixture.season);
      expect(partialSeeds.teams.every((team) => team.seed === null && team.seedPresentation?.label === "种子待确认")).toBe(true);

      await addSeedFacts(pool, fixture, true);
      const confirmedSeeds = await getMajorPublicParticipantSummary(fixture.season);
      expect(confirmedSeeds.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId)?.seed).toBe(1);
      expect(confirmedSeeds.teams.find((team) => team.entry.id === fixture.entries[31]?.entryId)?.seed).toBe(32);

      await freezeOfficialFacts(pool, fixture);
      const frozen = await getMajorPublicParticipantSummary(fixture.season);
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
