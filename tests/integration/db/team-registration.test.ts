import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { transferCompetitionEntryRepresentativeInTx } from "../../../src/lib/competition-entries/commands";
import { BUILT_IN_COMPETITIVE_PLATFORMS } from "../../../src/lib/competitive/builtins";
import { computeParticipantReadiness, loadParticipantQualificationFacts } from "../../../src/lib/qualification/service";
import { capturePostgresError, localDatabaseUrl, testSteam64 } from "./harness/database";

const databaseUrl = localDatabaseUrl();

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
  const client = await pool.connect();
  const ids = { season: randomUUID(), captain: randomUUID(), member: randomUUID(), team: randomUUID(), entry: randomUUID(), participant: randomUUID(), revision: randomUUID(), roster: randomUUID() };
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.captain, `captain-${ids.captain}@local.test`, ids.member, `member-${ids.member}@local.test`]);
    await client.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1, $2, 'Local Entry Registration', 'Major', 'registration', 'team', false, false, 2, 5)", [ids.season, `local-entry-${ids.season}`]);
    await client.query("INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Long-lived Local Team', $3, $3)", [ids.team, `local-team-${ids.team.slice(0, 8)}`, ids.captain]);
    await client.query("INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'active', $2), ($1, $3, 'active', $2)", [ids.team, ids.captain, ids.member]);
    await client.query("INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [ids.team, ids.captain]);
    await client.query("INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, 'Long-lived Local Team', 'local-test')", [ids.team]);
    await client.query("INSERT INTO competition_entries (id, competition_id, source, team_id, name, representative_user_id, current_roster_revision_id, registration_status) VALUES ($1, $2, 'linked_team', $3, 'Long-lived Local Team', $4, $5, 'draft')", [ids.entry, ids.season, ids.team, ids.member, ids.revision]);
    await client.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [ids.entry, ids.member]);
    await client.query("INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id) VALUES ($1, $2, $3, 'confirmed', now(), $3)", [ids.participant, ids.entry, ids.captain]);
    await client.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by) VALUES ($1, $2, 1, 'draft', 'local-test')", [ids.revision, ids.entry]);
    await client.query("INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.revision, ids.participant, ids.captain]);
    await client.query("INSERT INTO event_rosters (id, entry_id, source_roster_revision_id, status) VALUES ($1, $2, $3, 'preparing')", [ids.roster, ids.entry, ids.revision]);
    await client.query("INSERT INTO event_roster_members (event_roster_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.roster, ids.participant, ids.captain]);
    const facts = await client.query<{ entries: string; commitments: string; frozen_members: string }>("SELECT (SELECT count(*) FROM competition_entries WHERE id = $1) entries, (SELECT count(*) FROM competition_entry_participants WHERE entry_id = $1) commitments, (SELECT count(*) FROM event_roster_members WHERE event_roster_id = $2) frozen_members", [ids.entry, ids.roster]);
    if (facts.rows[0]?.entries !== "1" || facts.rows[0]?.commitments !== "1" || facts.rows[0]?.frozen_members !== "1") throw new Error("报名、成员确认与赛事名单未分别持久化。");
    const invalidEntryShape = await capturePostgresError(client, () => client.query("INSERT INTO competition_entries (competition_id, source, team_id, name, representative_user_id, current_roster_revision_id) VALUES ($1, 'event_native', $2, 'invalid', $3, gen_random_uuid())", [ids.season, ids.team, ids.captain]));
    expect(invalidEntryShape).toMatchObject({ code: "23514" });
    await client.query("SET LOCAL ROLE authenticated");
    const deniedDataApiRead = await capturePostgresError(client, () => client.query("SELECT id FROM competition_entries LIMIT 1"));
    expect(deniedDataApiRead).toMatchObject({ code: "42501" });
    await client.query("RESET ROLE");
    await client.query("ROLLBACK");
    await exerciseConcurrencyAndInvariants(pool);
    await exerciseQualificationWithRealCatalog(pool);
  } finally { client.release(); await pool.end(); }
}

async function exerciseConcurrencyAndInvariants(pool: Pool): Promise<void> {
  const ids = { season: randomUUID(), shared: randomUUID(), captainA: randomUUID(), captainB: randomUUID(), teamA: randomUUID(), teamB: randomUUID(), entryA: randomUUID(), entryB: randomUUID(), participantA: randomUUID(), participantB: randomUUID(), revisionA: randomUUID(), revisionB: randomUUID(), revisionA2: randomUUID(), rosterA: randomUUID(), rosterB: randomUUID(), eventMemberA: randomUUID(), eventMemberB: randomUUID(), match: randomUUID(), matchRoster: randomUUID() };
  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("INSERT INTO users (id, email) VALUES ($1,$2),($3,$4),($5,$6)", [ids.shared, `shared-${ids.shared}@local.test`, ids.captainA, `captain-a-${ids.captainA}@local.test`, ids.captainB, `captain-b-${ids.captainB}@local.test`]);
    await setup.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1,$2,'Local Entry Race','Major','registration','team',false,false,2,5)", [ids.season, `local-entry-race-${ids.season}`]);
    await setup.query("INSERT INTO teams (id,slug,name,creator_user_id,captain_user_id) VALUES ($1,$2,'Race Team A',$3,$3),($4,$5,'Race Team B',$6,$6)", [ids.teamA, `race-a-${ids.teamA.slice(0, 8)}`, ids.captainA, ids.teamB, `race-b-${ids.teamB.slice(0, 8)}`, ids.captainB]);
    await setup.query("INSERT INTO team_memberships (team_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'active',$2),($3,$4,'active',$4)", [ids.teamA, ids.captainA, ids.teamB, ids.captainB]);
    await setup.query("INSERT INTO team_captain_changes (team_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test'),($3,NULL,$4,'local-test')", [ids.teamA, ids.captainA, ids.teamB, ids.captainB]);
    await setup.query("INSERT INTO team_name_changes (team_id,old_name,new_name,changed_by_actor_id) VALUES ($1,NULL,'Race Team A','local-test'),($2,NULL,'Race Team B','local-test')", [ids.teamA, ids.teamB]);
    await setup.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,registration_status) VALUES ($1,$2,'event_native','Entry A',$3,$4,'draft'),($5,$2,'event_native','Entry B',$6,$7,'draft')", [ids.entryA, ids.season, ids.captainA, ids.revisionA, ids.entryB, ids.captainB, ids.revisionB]);
    await setup.query("INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test'),($3,NULL,$4,'local-test')", [ids.entryA, ids.captainA, ids.entryB, ids.captainB]);
    await setup.query("INSERT INTO competition_entry_participants (id,entry_id,user_id,status,invited_by_user_id) VALUES ($1,$2,$3,'invited',$4),($5,$6,$3,'invited',$7)", [ids.participantA, ids.entryA, ids.shared, ids.captainA, ids.participantB, ids.entryB, ids.captainB]);
    await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by) VALUES ($1,$2,1,'draft','local-test')", [ids.revisionA, ids.entryA]);
    await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by) VALUES ($1,$2,1,'draft','local-test')", [ids.revisionB, ids.entryB]);
    await setup.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [ids.rosterA, ids.entryA, ids.revisionA]);
    await setup.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [ids.rosterB, ids.entryB, ids.revisionB]);
    await setup.query("COMMIT");

    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryA, ids.participantA]);
      await first.query("UPDATE competition_entry_participants SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [ids.participantA]);
      const competingClaim = second.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryB, ids.participantB]).then(() => { throw new Error("同一用户同时确认两个 Entry 不应成功。"); }, (error: { code?: string }) => {
        if (error.code !== "23505") throw error;
      });
      await first.query("COMMIT");
      await competingClaim;
      await second.query("ROLLBACK");
    } finally { first.release(); second.release(); }
    const claims = await setup.query<{ count: string }>("SELECT count(*) FROM competition_entry_active_claims WHERE competition_id = $1 AND user_id = $2", [ids.season, ids.shared]);
    if (claims.rows[0]?.count !== "1") throw new Error("active commitment race 没有收敛为唯一 claim。");

    const membershipA = await pool.connect();
    const membershipB = await pool.connect();
    try {
      await membershipA.query("BEGIN");
      await membershipB.query("BEGIN");
      await membershipA.query("INSERT INTO team_memberships (team_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'benched',$3)", [ids.teamA, ids.shared, ids.captainA]);
      const competingMembership = membershipB.query("INSERT INTO team_memberships (team_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'active',$3)", [ids.teamB, ids.shared, ids.captainB]).then(() => { throw new Error("同一用户即使在原队伍为 benched，也不能同时进入第二支长期队伍。"); }, (error: { code?: string }) => {
        if (error.code !== "23505") throw error;
      });
      await membershipA.query("COMMIT");
      await competingMembership;
      await membershipB.query("ROLLBACK");
    } finally { membershipA.release(); membershipB.release(); }

    const executor = drizzle(pool, { schema });
    const representativeTransfer = await executor.transaction((tx) => transferCompetitionEntryRepresentativeInTx(tx, {
      entryId: ids.entryA,
      userId: ids.captainA,
      toUserId: ids.shared,
      actorId: "local-test",
    }));
    if (!representativeTransfer.seasonSlug) throw new Error("CompetitionEntry representative transfer 没有返回赛事上下文。");
    const representativeFacts = await setup.query<{ representative_user_id: string; from_user_id: string | null; to_user_id: string; audits: string }>(`
      SELECT entry.representative_user_id,
        change.from_user_id,
        change.to_user_id,
        (SELECT count(*)::text FROM audit_logs audit WHERE audit.action = 'competition_entry.representative.transfer' AND audit.target_id = entry.id::text) AS audits
      FROM competition_entries entry
      JOIN competition_entry_representative_changes change
        ON change.id = (SELECT id FROM competition_entry_representative_changes WHERE entry_id = entry.id ORDER BY changed_at DESC, id DESC LIMIT 1)
      WHERE entry.id = $1
    `, [ids.entryA]);
    if (representativeFacts.rows[0]?.representative_user_id !== ids.shared || representativeFacts.rows[0]?.from_user_id !== ids.captainA || representativeFacts.rows[0]?.to_user_id !== ids.shared || representativeFacts.rows[0]?.audits !== "1") {
      throw new Error("CompetitionEntry representative transfer 没有原子收敛 pointer、append-only history 与 audit。");
    }

    await setup.query("BEGIN");
    const captainMembershipInvariant = await capturePostgresError(setup, async () => {
      await setup.query("UPDATE team_memberships SET status = 'left', ended_at = now(), ended_reason = 'left' WHERE team_id = $1 AND user_id = $2 AND ended_at IS NULL", [ids.teamA, ids.captainA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(captainMembershipInvariant).toMatchObject({ code: "23514" });

    const crossEntryActiveClaim = await capturePostgresError(setup, async () => {
      await setup.query("DELETE FROM competition_entry_active_claims WHERE participant_id = $1", [ids.participantA]);
      await setup.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryA, ids.participantB]);
    });
    expect(crossEntryActiveClaim).toMatchObject({ code: "23514" });

    const crossEntryCurrentRevision = await capturePostgresError(setup, async () => {
      await setup.query("UPDATE competition_entries SET current_roster_revision_id = $2 WHERE id = $1", [ids.entryA, ids.revisionB]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(crossEntryCurrentRevision).toMatchObject({ code: "23503" });

    const unapprovedRevisionPointer = await capturePostgresError(setup, async () => {
      await setup.query("UPDATE competition_entries SET approved_roster_revision_id = $2 WHERE id = $1", [ids.entryA, ids.revisionA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(unapprovedRevisionPointer).toMatchObject({ code: "23514" });

    const staleCurrentRevision = await capturePostgresError(setup, async () => {
      await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by) VALUES ($1,$2,2,'draft','local-test')", [ids.revisionA2, ids.entryA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(staleCurrentRevision).toMatchObject({ code: "23514" });

    const staleEventRosterSource = await capturePostgresError(setup, async () => {
      await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES ($1,$2,2,'approved','local-test',now())", [ids.revisionA2, ids.entryA]);
      await setup.query("UPDATE competition_entries SET current_roster_revision_id = $2, approved_roster_revision_id = $2 WHERE id = $1", [ids.entryA, ids.revisionA2]);
      await setup.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [ids.rosterA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(staleEventRosterSource).toMatchObject({ code: "23514" });

    const crossEntryRosterMember = await capturePostgresError(setup, () => setup.query("INSERT INTO competition_entry_roster_members (revision_id,participant_id,user_id) VALUES ($1,$2,$3)", [ids.revisionA, ids.participantB, ids.shared]));
    expect(crossEntryRosterMember).toMatchObject({ code: "23514" });
    const duplicateParticipant = await capturePostgresError(setup, () => setup.query("INSERT INTO competition_entry_participants (entry_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'invited',$3)", [ids.entryA, ids.shared, ids.captainA]));
    expect(duplicateParticipant).toMatchObject({ code: "23505" });
    await setup.query("INSERT INTO event_roster_members (id,event_roster_id,participant_id,user_id) VALUES ($1,$2,$3,$4)", [ids.eventMemberA, ids.rosterA, ids.participantA, ids.shared]);
    await setup.query("INSERT INTO event_roster_members (id,event_roster_id,participant_id,user_id) VALUES ($1,$2,$3,$4)", [ids.eventMemberB, ids.rosterB, ids.participantB, ids.shared]);
    await setup.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage) VALUES ($1,$2,$3,$4,'fixture')", [ids.match, ids.season, ids.entryA, ids.entryB]);
    await setup.query("INSERT INTO match_rosters (id,match_id,entry_id,source,status) VALUES ($1,$2,$3,'admin_select','submitted')", [ids.matchRoster, ids.match, ids.entryA]);
    const crossEntryMatchPlayer = await capturePostgresError(setup, () => setup.query("INSERT INTO match_roster_players (roster_id,event_roster_member_id) VALUES ($1,$2)", [ids.matchRoster, ids.eventMemberB]));
    expect(crossEntryMatchPlayer).toMatchObject({ code: "23514" });
    await setup.query("INSERT INTO match_roster_players (roster_id,event_roster_member_id) VALUES ($1,$2)", [ids.matchRoster, ids.eventMemberA]);
    await setup.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'preparing', confirmed_at = NULL, confirmed_by = NULL, frozen_at = NULL, frozen_by = NULL WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'frozen', confirmed_at = now(), confirmed_by = 'local-test', frozen_at = now(), frozen_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    const frozenRosterMemberDelete = await capturePostgresError(setup, () => setup.query("DELETE FROM event_roster_members WHERE event_roster_id = $1", [ids.rosterA]));
    expect(frozenRosterMemberDelete).toMatchObject({ code: "23514" });
    const frozenRosterReopen = await capturePostgresError(setup, () => setup.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [ids.rosterA]));
    expect(frozenRosterReopen).toMatchObject({ code: "23514" });
    await setup.query("ROLLBACK");
  } finally {
    try {
      await setup.query("BEGIN");
      await setup.query("SET LOCAL session_replication_role = replica");
      await setup.query("DELETE FROM competition_entry_active_claims WHERE competition_id = $1", [ids.season]);
      await setup.query("DELETE FROM event_roster_members WHERE event_roster_id IN ($1,$2)", [ids.rosterA, ids.rosterB]);
      await setup.query("DELETE FROM event_rosters WHERE id IN ($1,$2)", [ids.rosterA, ids.rosterB]);
      await setup.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN ($1,$2,$3)", [ids.revisionA, ids.revisionB, ids.revisionA2]);
      await setup.query("DELETE FROM competition_entry_roster_revisions WHERE id IN ($1,$2,$3)", [ids.revisionA, ids.revisionB, ids.revisionA2]);
      await setup.query("DELETE FROM competition_entry_participants WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await setup.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await setup.query("DELETE FROM competition_entries WHERE id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await setup.query("DELETE FROM team_captain_changes WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM team_name_changes WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM team_memberships WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM teams WHERE id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
      await setup.query("DELETE FROM users WHERE id IN ($1,$2,$3)", [ids.shared, ids.captainA, ids.captainB]);
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }
  }
}

/**
 * Combined acceptance against the real 0020 built-in catalog (no mock
 * S23/S24): a non-star A++ member, two S-tier members with exact stars must
 * reach competitive readiness, while an off-ladder rank fails the published
 * mapping. The
 * canonical qualification evaluator owns every stars decision — the
 * CompetitionEntry UI only consumes readiness props.
 */
async function exerciseQualificationWithRealCatalog(pool: Pool): Promise<void> {
  const perfect = BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world;
  const config = {
    platform: perfect.key,
    currentSeasonKey: "2026s2",
    previousSeasonKey: "2026s1",
    rankOrder: perfect.ranks.map((rank) => rank.rankKey),
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = { normal: randomUUID(), star: randomUUID(), secondStar: randomUUID(), offLadder: randomUUID() };
    const values: Array<[string, string, string, string, number | null]> = [];
    for (const [key, rank] of [["normal", "A++"], ["star", "魔王S"], ["secondStar", "黄金S"], ["offLadder", "Grandmaster"]] as const) {
      // Every declared S-tier fact must carry its exact stars; an old NULL
      // value is incomplete profile data and is not a readiness pass-through.
      values.push([users[key], `${key}-${users[key]}@local.test`, rank, rank, key === "star" ? 50 : key === "secondStar" ? 10 : null]);
    }
    for (const [id, email] of values) {
      await client.query(
        `INSERT INTO users (id, email, display_name, steam64, perfect_name, qq, email_verified_at)
         VALUES ($1, $2, '选手', $3, $4, '100000001', now())`,
        [id, email, testSteam64(id), `pw-${id}`],
      );
    }
    for (const [id, , historical, current, stars] of values) {
      await client.query(
        `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating, stars)
         VALUES ($1, 'perfect_world', 'historical_peak', NULL, $2, 1500, $4),
                ($1, 'perfect_world', 'season_peak', '2026s1', $2, 1400, $4),
                ($1, 'perfect_world', 'season_peak', '2026s2', $3, 1600, $4)`,
        [id, historical, current, stars],
      );
    }
    const executor = drizzle(client, { schema });
    const factRows = await loadParticipantQualificationFacts(Object.values(users), { executor });
    for (const [key, userId] of Object.entries(users)) {
      const readiness = computeParticipantReadiness(factRows.get(userId)!, config);
      if (key === "offLadder") {
        if (readiness.strength && readiness.blockers.every((blocker) => !blocker.includes("申报段位不在本赛事公布的段位映射中"))) {
          throw new Error("不在公布段位映射中的 rank 必须被 canonical evaluator 拒绝。");
        }
        continue;
      }
      if (readiness.blockers.some((blocker) => /段位|赛季/.test(blocker))) {
        throw new Error(`${key} 成员不应出现竞技 blocker：${JSON.stringify(readiness.blockers)}`);
      }
      if (!readiness.strength || readiness.strength.historicalPeak === null) {
        throw new Error(`${key} 成员的 strength 输入缺失 historicalPeak。`);
      }
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

describe("team registration PostgreSQL invariants", () => {
  it("keeps commitment, roster, qualification, and privacy boundaries intact", async () => {
    await main();
  });
});
