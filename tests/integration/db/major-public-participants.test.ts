import { getParticipantSummary } from "../../../src/lib/participants/summary";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { createMajorDefaultCapabilities } from "../../../src/lib/competition/templates";
import {
  getMajorPublicParticipantOverview,
  getMajorPublicParticipantSummary,
  getMajorPublicParticipantTeam,
  type MajorPublicParticipantSeason,
} from "../../../src/lib/major/public-participants";
import { checkStandardMajorCapabilities } from "../../../src/lib/competition/definition";
import { createLocalPool } from "./harness/database";

const observation = vi.hoisted(() => ({ queries: [] as Array<{ query: string; params: unknown[] }> }));
vi.mock("@/db/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  return { ...actual, db: drizzle((actual.db as typeof actual.db & { $client: Pool }).$client, {
    schema, logger: { logQuery: (query, params) => observation.queries.push({ query, params }) },
  }) };
});

// Preserve the detailed view's lifecycle/count semantics while enforcing a
// count-only database response: directory cards must not fetch player payloads.
async function expectOverviewMatches(season: MajorPublicParticipantSeason) {
  const { teams: _teams, matchCount: _matches, finishedMatchCount: _finished, ...expected } = await getMajorPublicParticipantSummary(season);
  void _teams; void _matches; void _finished;
  observation.queries = [];
  const actual = await getMajorPublicParticipantOverview(season);
  expect(actual).toEqual(expected);
  const rosterReads = observation.queries.map(({ query }) => query).filter(query => /from "(?:competition_entry_roster_members|event_roster_members)"/.test(query));
  expect(rosterReads).toHaveLength(actual.teamCount ? 1 : 0);
  for (const query of rosterReads) expect(query.split(" from ")[0]).toBe("select count(*)");
  return actual;
}

// The existing lifecycle fixture protects public membership; also enforce that
// reads transfer only the roster source that can contribute to the returned DTO.
async function expectRosterSources<T>(
  operation: () => Promise<T>,
  approvedEntryIds: string[],
  eventEntryIds: string[],
): Promise<T> {
  observation.queries = [];
  const result = await operation();
  for (const [source, expected] of [
    ["competition_entry_roster_members", approvedEntryIds],
    ["event_roster_members", eventEntryIds],
  ] as const) {
    const reads = observation.queries.filter(({ query }) => query.includes(`from "${source}"`));
    expect(reads).toHaveLength(expected.length ? 1 : 0);
    if (expected.length) {
      // Source filters have one trailing status/current parameter.
      expect(new Set(reads[0]!.params.slice(0, -1))).toEqual(new Set(expected));
    }
  }
  return result;
}

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
    steam64: entryIndex === 0 && userIndex === 1 ? "76561198000000001" : null,
    avatarUrl: entryIndex === 0 && userIndex === 1 ? "https://cdn.test/major-player-0-1.webp" : null,
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
      `INSERT INTO users (id, email, display_name, perfect_name, steam64)
       SELECT user_id, email, display_name, perfect_name, steam64
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
       AS rows(user_id, email, display_name, perfect_name, steam64)`,
      [
        userRows.map((row) => row.userId),
        userRows.map((row) => row.email),
        userRows.map((row) => row.displayName),
        userRows.map((row) => row.perfectName),
        userRows.map((row) => row.steam64),
      ],
    );
    await client.query(
      `INSERT INTO steam_profiles (steam64, persona_name, profile_url, avatar_url)
       VALUES ($1, $2, $3, $4)`,
      [
        userRows.find((row) => row.steam64)?.steam64,
        "Official participant",
        "https://steamcommunity.com/profiles/76561198000000001",
        userRows.find((row) => row.steam64)?.avatarUrl,
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
    await client.query("DELETE FROM steam_profiles WHERE steam64 = $1", ["76561198000000001"]);
    await client.query("DELETE FROM season_registrations WHERE season_id = $1", [fixture.season.id]);
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
      expect(await getParticipantSummary(fixture.season)).toEqual({ count: 0, hasPlayers: false });
      await pool.query(`INSERT INTO season_registrations (user_id, season_id, primary_position, secondary_position, peak_rank, peak_rank_season, peak_rating, current_season_peak_rank, current_rating, gameplay_style, status)
        SELECT user_id, $1, 'opener', 'closer', 'A', 'S1', 1, 'A', 1, 'fixture', status::registration_status
        FROM unnest($2::uuid[], $3::text[]) AS rows(user_id, status)`, [fixture.season.id, fixture.entries[0]!.userIds.slice(0, 4), ['pending', 'approved', 'rejected', 'waitlisted']]);
      expect(await getParticipantSummary({ id: fixture.season.id, registrationMode: 'solo' })).toEqual({ count: 1, hasPlayers: true });
      await expectOverviewMatches({ ...fixture.season, id: randomUUID() });
      await expectOverviewMatches(fixture.season);
      const approvedIds = fixture.entries.map((entry) => entry.entryId);
      const officialIds = approvedIds.slice(0, fixture.entrantIds.length);
      const unselectedIds = approvedIds.slice(fixture.entrantIds.length);
      const candidate = await expectRosterSources(() => getMajorPublicParticipantSummary(fixture.season), approvedIds, []);
      expect(candidate.phase).toBe("approved_candidates");
      expect(candidate.teams).toHaveLength(33);
      expect(candidate.playerCount).toBe(33 * 5);
      expect(candidate.presentation.teamCollectionLabel).toBe("已通过报名审核的队伍");
      expect(candidate.teams.every((team) => team.rosterLabel === "已审核报名名单")).toBe(true);

      const candidatePlayers = candidate.teams.flatMap((team) => team.roster);
      expect(candidatePlayers).toHaveLength(33 * 5);
      expect(candidatePlayers.find((player) => player.userId === fixture.entries[0]?.userIds[1])?.avatarUrl).toBe("https://cdn.test/major-player-0-1.webp");

      const candidateDetail = await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[32]!.entryId), unselectedIds, []);
      expect(candidateDetail?.participation).toMatchObject({
        label: "已通过报名审核",
        detail: "已通过报名审核，正赛资格待确认。",
      });
      expect(candidateDetail?.rosterLabel).toBe("已审核报名名单");

      await makeOfficialFacts(pool, fixture);
      await pool.query("UPDATE event_roster_members SET is_primary_starter = false WHERE event_roster_id = $1 AND user_id = $2", [fixture.eventRosterIds[0], fixture.entries[0]!.userIds[5]]);
      await expectOverviewMatches(fixture.season);
      expect(await getParticipantSummary(fixture.season)).toEqual({ count: 160, hasPlayers: true });
      expect(await getParticipantSummary({ id: randomUUID(), registrationMode: 'team' })).toEqual({ count: 0, hasPlayers: false });
      await pool.query('UPDATE event_roster_members SET is_current = false WHERE event_roster_id = $1 AND user_id = $2', [fixture.eventRosterIds[0], fixture.entries[0]!.userIds[1]]);
      await expectOverviewMatches(fixture.season);
      expect(await getParticipantSummary(fixture.season)).toEqual({ count: 159, hasPlayers: true });
      await pool.query('UPDATE event_roster_members SET is_current = true WHERE event_roster_id = $1 AND user_id = $2', [fixture.eventRosterIds[0], fixture.entries[0]!.userIds[1]]);
      const partialEntrant = await pool.query("DELETE FROM major_tournament_entrants WHERE id = $1 RETURNING *", [fixture.entrantIds[0]]);
      const partialSet = await expectRosterSources(() => getMajorPublicParticipantSummary(fixture.season), approvedIds, []);
      expect(partialSet.phase).toBe("approved_candidates");
      const partialTeam = await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[1]!.entryId), [fixture.entries[1]!.entryId], []);
      expect(partialTeam?.roster).toEqual(candidate.teams.find((team) => team.entry.id === fixture.entries[1]!.entryId)?.roster);
      await pool.query("INSERT INTO major_tournament_entrants SELECT * FROM json_populate_recordset(NULL::major_tournament_entrants, $1::json)", [JSON.stringify(partialEntrant.rows)]);
      await pool.query("UPDATE competition_entries SET registration_status = 'draft' WHERE id = $1", [fixture.entries[0]!.entryId]);
      expect((await expectOverviewMatches(fixture.season)).phase).toBe("approved_candidates");
      expect(await getParticipantSummary(fixture.season)).toEqual({ count: 155, hasPlayers: true });
      await expectRosterSources(() => getMajorPublicParticipantSummary(fixture.season), approvedIds.slice(1), []);
      await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[1]!.entryId), [fixture.entries[1]!.entryId], []);
      await pool.query("UPDATE competition_entries SET registration_status = 'approved' WHERE id = $1", [fixture.entries[0]!.entryId]);
      const final = await expectRosterSources(() => getMajorPublicParticipantSummary(fixture.season), unselectedIds, officialIds);
      expect(final.phase).toBe("final_entrants");
      expect(final.teams).toHaveLength(32);
      expect(final.teams.some((team) => team.entry.id === fixture.entries[32]?.entryId)).toBe(false);
      expect(final.playerCount).toBe(32 * 5);
      expect(final.teams.every((team) => team.rosterLabel === "当前参赛名单")).toBe(true);
      expect(final.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId)?.roster.some((member) => member.name === "公开选手 0-1")).toBe(true);
      const finalPlayers = final.teams.flatMap((team) => team.roster);
      expect(finalPlayers.find((player) => player.userId === fixture.entries[0]?.userIds[1])?.avatarUrl).toBe("https://cdn.test/major-player-0-1.webp");
      expect(finalPlayers.find((player) => player.userId === fixture.entries[0]!.userIds[5])?.isStarter).toBe(false);

      const unselectedDetail = await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[32]!.entryId), unselectedIds, []);
      expect(unselectedDetail?.roster).toEqual(candidateDetail?.roster);
      expect(unselectedDetail?.participation.detail).toBe("已通过报名审核，但未进入本届正式参赛名单。");
      const officialDetail = await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[0]!.entryId), [], [fixture.entries[0]!.entryId]);
      expect(officialDetail?.roster).toEqual(final.teams.find((team) => team.entry.id === fixture.entries[0]!.entryId)?.roster);
      expect(await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, randomUUID()), [], [])).toBeNull();

      // A complete entrant set does not authorize falling back to an approved
      // roster when the official event roster is missing.
      const missingRoster = await pool.query("SELECT * FROM event_rosters WHERE id = $1", [fixture.eventRosterIds[0]]);
      const missingMembers = await pool.query("SELECT * FROM event_roster_members WHERE event_roster_id = $1", [fixture.eventRosterIds[0]]);
      await pool.query("DELETE FROM event_roster_members WHERE event_roster_id = $1", [fixture.eventRosterIds[0]]);
      await pool.query("DELETE FROM event_rosters WHERE id = $1", [fixture.eventRosterIds[0]]);
      const missing = await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[0]!.entryId), [], [fixture.entries[0]!.entryId]);
      expect(missing?.roster).toEqual([]);
      expect(missing?.rosterStatus).toBeNull();
      expect(missing?.rosterLabel).toBe("当前参赛名单");
      expect((await expectRosterSources(() => getMajorPublicParticipantSummary(fixture.season), unselectedIds, officialIds)).playerCount).toBe(155);
      await pool.query("INSERT INTO event_rosters SELECT * FROM json_populate_recordset(NULL::event_rosters, $1::json)", [JSON.stringify(missingRoster.rows)]);
      await pool.query("INSERT INTO event_roster_members SELECT * FROM json_populate_recordset(NULL::event_roster_members, $1::json)", [JSON.stringify(missingMembers.rows)]);

      await addSeedFacts(pool, fixture, false);
      const partialSeeds = await getMajorPublicParticipantSummary(fixture.season);
      expect(partialSeeds.teams.every((team) => team.seed === null && team.seedPresentation?.label === "种子待确认")).toBe(true);

      await addSeedFacts(pool, fixture, true);
      const confirmedSeeds = await getMajorPublicParticipantSummary(fixture.season);
      expect(confirmedSeeds.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId)?.seed).toBe(1);
      expect(confirmedSeeds.teams.find((team) => team.entry.id === fixture.entries[31]?.entryId)?.seed).toBe(32);

      await freezeOfficialFacts(pool, fixture);
      expect(await getParticipantSummary(fixture.season)).toEqual({ count: 159, hasPlayers: true });
      expect(await getParticipantSummary({ id: fixture.season.id, registrationMode: 'solo' })).toEqual({ count: 0, hasPlayers: false });
      expect((await expectOverviewMatches(fixture.season)).playerCount).toBe(160);
      const frozen = await expectRosterSources(() => getMajorPublicParticipantSummary(fixture.season), unselectedIds, officialIds);
      expect(frozen.phase).toBe("rosters_frozen");
      expect(frozen.teams.every((team) => team.rosterLabel === "最终参赛名单")).toBe(true);

      const frozenTeam = frozen.teams.find((team) => team.entry.id === fixture.entries[0]?.entryId);
      expect(frozenTeam?.roster.find((member) => member.userId === fixture.entries[0]?.userIds[1])?.isStarter).toBe(true);
      const frozenPlayers = frozen.teams.flatMap((team) => team.roster);
      const frozenDetail = await expectRosterSources(() => getMajorPublicParticipantTeam(fixture.season, fixture.entries[0]!.entryId), [], [fixture.entries[0]!.entryId]);
      expect(frozenDetail?.roster).toEqual(frozenTeam?.roster);
      expect(frozenPlayers.find((player) => player.userId === fixture.entries[0]?.userIds[1])?.avatarUrl).toBe("https://cdn.test/major-player-0-1.webp");
    } finally {
      await cleanupFixture(pool, fixture);
      await pool.end();
    }
  });
});
