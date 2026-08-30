/**
 * Local PostgreSQL composition acceptance for the user-facing My read model.
 * It writes a complete, isolated fact set, reads it through the same server
 * loader as /my, then deletes only the generated rows.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadMyReadiness } from "../../src/lib/my/readiness";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("我的资料集成测试只允许 Local Supabase loopback 数据库。");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const ids = { user: randomUUID(), team: randomUUID(), season: randomUUID(), entry: randomUUID(), participant: randomUUID(), sanction: randomUUID() };
  let committed = false;
  try {
    const platform = await client.query<{ key: string }>("SELECT key FROM competitive_platforms ORDER BY key LIMIT 1");
    const platformKey = platform.rows[0]?.key;
    assert.ok(platformKey, "Local fixture 需要至少一个竞技平台目录。");
    const catalog = await client.query<{ season_key: string; is_current: boolean; rank_key: string }>(
      `SELECT season.season_key, season.is_current, rank.rank_key
       FROM competitive_platform_seasons season
       CROSS JOIN LATERAL (SELECT rank_key FROM competitive_platform_ranks WHERE platform_key = season.platform ORDER BY sort_order DESC LIMIT 1) rank
       WHERE season.platform = $1 AND season.active = true
       ORDER BY season.sort_order DESC`,
      [platformKey],
    );
    const current = catalog.rows.find((row) => row.is_current);
    const previous = catalog.rows.find((row) => !row.is_current);
    assert.ok(current && previous, "Local fixture 需要当前与上一赛季目录。");
    const ranks = await client.query<{ rank_key: string }>("SELECT rank_key FROM competitive_platform_ranks WHERE platform_key = $1 ORDER BY sort_order", [platformKey]);
    assert.ok(ranks.rows.length > 0, "Local fixture 需要竞技段位表。");
    const institution = await client.query<{ id: string }>("SELECT id FROM institutions ORDER BY created_at LIMIT 1");
    assert.ok(institution.rows[0], "Local fixture 需要教育机构目录。");
    const config = { requireCompetitiveProfile: true, competitiveProfile: { platform: platformKey, currentSeasonKey: current.season_key, previousSeasonKey: previous.season_key, rankOrder: ranks.rows.map((row) => row.rank_key) } };
    await client.query("BEGIN");
    await client.query(`INSERT INTO users (id, email, display_name, steam64, perfect_id, qq, email_verified_at) VALUES ($1, $2, 'Local 我的选手', '76561198000000001', $3, '100001', now())`, [ids.user, `my-readiness-${ids.user}@local.test`, `perfect-${ids.user}`]);
    await client.query(`INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at) VALUES ($1, $2, 'enrolled', 'manual_other', 'approved', 'local-admin', now())`, [ids.user, institution.rows[0]!.id]);
    for (const [kind, seasonKey] of [["historical_peak", null], ["season_peak", previous.season_key], ["season_peak", current.season_key]] as const) {
      await client.query(`INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating) VALUES ($1, $2, $3, $4, $5, 2000)`, [ids.user, platformKey, kind, seasonKey, ranks.rows.at(-1)!.rank_key]);
    }
    await client.query(`INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Local 我的 Team', $3, $3)`, [ids.team, `local-my-${ids.team.slice(0, 8)}`, ids.user]);
    await client.query(`INSERT INTO team_memberships (team_id, user_id, status, role, invited_by_user_id) VALUES ($1, $2, 'active', 'captain', $2)`, [ids.team, ids.user]);
    await client.query(`INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size, team_registration_config) VALUES ($1, $2, 'Local 我的赛事', 'Major', 'registration', 'team', false, false, 1, 5, $3::json)`, [ids.season, `local-my-season-${ids.season.slice(0, 8)}`, JSON.stringify(config)]);
    await client.query(`INSERT INTO competition_entries (id, competition_id, source, team_id, name, representative_user_id, registration_status) VALUES ($1, $2, 'linked_team', $3, 'Local 我的 Entry', $4, 'approved')`, [ids.entry, ids.season, ids.team, ids.user]);
    await client.query(`INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id) VALUES ($1, $2, $3, 'confirmed', now(), $3)`, [ids.participant, ids.entry, ids.user]);
    await client.query(`INSERT INTO disciplinary_cases (id, season_id, subject_user_id, status, effects, public_explanation, effective_from, issued_by) VALUES ($1, $2, $3, 'active', $4::jsonb, 'Local 公开说明', now() - interval '1 minute', 'local-admin')`, [ids.sanction, ids.season, ids.user, JSON.stringify(["registration_block", "roster_block", "match_participation_block"])]);
    await client.query("COMMIT");
    committed = true;

    const model = await loadMyReadiness(ids.user);
    assert.equal(model.profile.state, "ready");
    assert.equal(model.education.state, "ready");
    assert.ok(model.competitiveProfiles.some((profile) => profile.key === platformKey && profile.state === "ready"), "竞技档案应由 catalog/profile owner 判定为 ready。");
    assert.equal(model.team.state, "ready");
    assert.equal(model.competitions.length, 1);
    assert.equal(model.competitions[0]?.entry.state, "ready");
    assert.equal(model.competitions[0]?.qualification.state, "ready");
    assert.deepEqual(model.competitions[0]?.sanctions[0]?.effects, ["registration_block", "roster_block", "match_participation_block"]);
    assert.equal(JSON.stringify(model).includes("internalEvidence"), false);
    console.log("我的资料 Local PostgreSQL composition suite passed.");
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    if (committed) {
      await client.query("BEGIN");
      await client.query("DELETE FROM disciplinary_cases WHERE id = $1", [ids.sanction]);
      await client.query("DELETE FROM competition_entry_participants WHERE id = $1", [ids.participant]);
      await client.query("DELETE FROM competition_entries WHERE id = $1", [ids.entry]);
      await client.query("DELETE FROM team_memberships WHERE team_id = $1", [ids.team]);
      await client.query("DELETE FROM teams WHERE id = $1", [ids.team]);
      await client.query("DELETE FROM education_verifications WHERE user_id = $1", [ids.user]);
      await client.query("DELETE FROM competitive_rank_facts WHERE user_id = $1", [ids.user]);
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
      await client.query("DELETE FROM users WHERE id = $1", [ids.user]);
      await client.query("COMMIT");
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
