/**
 * Local PostgreSQL composition acceptance for the user-facing My read model.
 * It writes a complete, isolated fact set, reads it through the same server
 * loader as /my, then deletes only the generated rows.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { loadMyReadiness } from "../../../src/lib/my/readiness";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const ids = {
    user: randomUUID(),
    noTeamUser: randomUUID(),
    activeTeam: randomUUID(),
    benchedTeam: randomUUID(),
    benchedCaptain: randomUUID(),
    season: randomUUID(),
    entry: randomUUID(),
    revision: randomUUID(),
    participant: randomUUID(),
    sanction: randomUUID(),
    invitation: randomUUID(),
  };
  let committed = false;
  try {
    const platform = await client.query<{ key: string }>("SELECT key FROM competitive_platforms ORDER BY key LIMIT 1");
    const platformKey = platform.rows[0]?.key;
    expect(platformKey).toBeTruthy();
    const catalog = await client.query<{ season_key: string; is_current: boolean; rank_key: string; star_min: number | null }>(
      `SELECT season.season_key, season.is_current, rank.rank_key, rank.star_min
       FROM competitive_platform_seasons season
       CROSS JOIN LATERAL (SELECT rank_key, star_min FROM competitive_platform_ranks WHERE platform_key = season.platform ORDER BY sort_order DESC LIMIT 1) rank
       WHERE season.platform = $1 AND season.active = true
       ORDER BY season.sort_order DESC`,
      [platformKey],
    );
    const current = catalog.rows.find((row) => row.is_current);
    const previous = catalog.rows.find((row) => !row.is_current);
    expect(current).toBeDefined();
    expect(previous).toBeDefined();
    if (!current || !previous) throw new Error("Local fixture 需要当前与上一赛季目录。");
    const ranks = await client.query<{ rank_key: string; star_min: number | null }>("SELECT rank_key, star_min FROM competitive_platform_ranks WHERE platform_key = $1 ORDER BY sort_order", [platformKey]);
    expect(ranks.rows.length).toBeGreaterThan(0);
    const institution = await client.query<{ id: string }>("SELECT id FROM institutions ORDER BY created_at LIMIT 1");
    expect(institution.rows[0]).toBeTruthy();
    const config = { requireCompetitiveProfile: true, competitiveProfile: { platform: platformKey, currentSeasonKey: current.season_key, previousSeasonKey: previous.season_key, rankOrder: ranks.rows.map((row) => row.rank_key) } };
    await client.query("BEGIN");
    await client.query(`INSERT INTO users (id, email, display_name, steam64, perfect_name, qq, email_verified_at) VALUES ($1, $2, 'Local 我的选手', '76561198000000001', $3, '100001', now()), ($4, $5, 'Local 替补队长', '76561198000000002', $6, '100002', now()), ($7, $8, 'Local 待处理邀请', NULL, NULL, NULL, now())`, [ids.user, `my-readiness-${ids.user}@local.test`, `perfect-${ids.user}`, ids.benchedCaptain, `my-readiness-benched-${ids.benchedCaptain}@local.test`, `perfect-${ids.benchedCaptain}`, ids.noTeamUser, `my-readiness-invitee-${ids.noTeamUser}@local.test`]);
    await client.query(`INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at) VALUES ($1, $2, 'enrolled', 'manual_other', 'approved', 'local-admin', now())`, [ids.user, institution.rows[0]!.id]);
    for (const [kind, seasonKey] of [["historical_peak", null], ["season_peak", previous.season_key], ["season_peak", current.season_key]] as const) {
      const peakRank = ranks.rows.at(-1)!;
      await client.query(`INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating, stars) VALUES ($1, $2, $3, $4, $5, 2000, $6)`, [ids.user, platformKey, kind, seasonKey, peakRank.rank_key, peakRank.star_min]);
    }
    await client.query(`INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Local 我的 Team', $3, $3), ($4, $5, 'Local 替补 Team', $6, $6)`, [ids.activeTeam, `local-my-${ids.activeTeam.slice(0, 8)}`, ids.user, ids.benchedTeam, `local-my-benched-${ids.benchedTeam.slice(0, 8)}`, ids.benchedCaptain]);
    await client.query(`INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'active', $2), ($3, $4, 'active', $4)`, [ids.activeTeam, ids.user, ids.benchedTeam, ids.benchedCaptain]);
    await client.query(`INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-admin'), ($3, NULL, $4, 'local-admin')`, [ids.activeTeam, ids.user, ids.benchedTeam, ids.benchedCaptain]);
    await client.query(`INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, 'Local 我的 Team', 'local-admin'), ($2, NULL, 'Local 替补 Team', 'local-admin')`, [ids.activeTeam, ids.benchedTeam]);
    await client.query(`INSERT INTO team_invitations (id, team_id, kind, invited_user_id, invited_by_user_id, status, expires_at) VALUES ($1, $2, 'direct', $3, $4, 'pending', now() + interval '7 days')`, [ids.invitation, ids.benchedTeam, ids.noTeamUser, ids.benchedCaptain]);
    await client.query(`INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size, team_registration_config) VALUES ($1, $2, 'Local 我的赛事', 'Major', 'registration', 'team', false, false, 1, 5, $3::json)`, [ids.season, `local-my-season-${ids.season.slice(0, 8)}`, JSON.stringify(config)]);
    await client.query(`INSERT INTO competition_entries (id, competition_id, source, team_id, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status) VALUES ($1, $2, 'linked_team', $3, 'Local 我的 Entry', $4, $5, $5, 'approved')`, [ids.entry, ids.season, ids.activeTeam, ids.user, ids.revision]);
    await client.query(`INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-admin')`, [ids.entry, ids.user]);
    await client.query(`INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id) VALUES ($1, $2, $3, 'confirmed', now(), $3)`, [ids.participant, ids.entry, ids.user]);
    await client.query(`INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at) VALUES ($1, $2, 1, 'approved', 'local-admin', now())`, [ids.revision, ids.entry]);
    await client.query(`INSERT INTO disciplinary_cases (id, season_id, subject_user_id, status, effects, public_explanation, effective_from, issued_by) VALUES ($1, $2, $3, 'active', $4::jsonb, 'Local 公开说明', now() - interval '1 minute', 'local-admin')`, [ids.sanction, ids.season, ids.user, JSON.stringify(["registration_block", "roster_block", "match_participation_block"])]);
    await client.query("COMMIT");
    committed = true;

    const model = await loadMyReadiness(ids.user);
    expect(model.profile.state).toBe("ready");
    expect(model.education.state).toBe("ready");
    expect(model.competitiveProfiles.some((profile) => profile.key === platformKey && profile.state === "ready")).toBe(true);
    expect(model.team.state).toBe("ready");
    expect(model.team.detail).toMatch(/Local 我的 Team/);
    expect(model.competitions).toHaveLength(1);
    expect(model.competitions[0]?.entry.state).toBe("ready");
    expect(model.competitions[0]?.qualification.state).toBe("ready");
    expect(model.competitions[0]?.sanctions[0]?.effects).toEqual(["registration_block", "roster_block", "match_participation_block"]);
    expect(JSON.stringify(model)).not.toContain("internalEvidence");

    const pendingInvitationModel = await loadMyReadiness(ids.noTeamUser);
    expect(pendingInvitationModel.team).toMatchObject({
      state: "waiting",
      detail: "你有 1 个待处理的队伍邀请。接受邀请即加入队伍，不需要再次申请或等待审核。",
      cta: { href: "/my/teams", label: "处理队伍邀请" },
      secondaryCta: { href: "/teams/recruitment?view=teams", label: "寻找队伍" },
    });
    console.log("我的资料 Local PostgreSQL composition suite passed.");
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    if (committed) {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM team_invitations WHERE id = $1", [ids.invitation]);
      await client.query("DELETE FROM disciplinary_cases WHERE id = $1", [ids.sanction]);
      await client.query("DELETE FROM competition_entry_participants WHERE id = $1", [ids.participant]);
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE id = $1", [ids.revision]);
      await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = $1", [ids.entry]);
      await client.query("DELETE FROM competition_entries WHERE id = $1", [ids.entry]);
      await client.query("DELETE FROM team_captain_changes WHERE team_id IN ($1, $2)", [ids.activeTeam, ids.benchedTeam]);
      await client.query("DELETE FROM team_name_changes WHERE team_id IN ($1, $2)", [ids.activeTeam, ids.benchedTeam]);
      await client.query("DELETE FROM team_memberships WHERE team_id IN ($1, $2)", [ids.activeTeam, ids.benchedTeam]);
      await client.query("DELETE FROM teams WHERE id IN ($1, $2)", [ids.activeTeam, ids.benchedTeam]);
      await client.query("DELETE FROM education_verifications WHERE user_id = $1", [ids.user]);
      await client.query("DELETE FROM competitive_rank_facts WHERE user_id = $1", [ids.user]);
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
      await client.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [ids.user, ids.benchedCaptain, ids.noTeamUser]);
      await client.query("COMMIT");
    }
    client.release();
    await pool.end();
  }
}

describe("my readiness PostgreSQL composition", () => {
  it("reads the user-facing readiness model from isolated facts", async () => {
    await main();
  });
});
