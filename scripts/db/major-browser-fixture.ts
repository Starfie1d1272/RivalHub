import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { createMajorDefaultCapabilities } from "../../src/types/season";
import { createPerfectWorldRankOrder } from "../../src/lib/config/perfect-world";
import { assertDeclaredDatabaseTarget, assertLocalDatabaseUrl, assertLocalHttpUrl } from "./local-environment";

const FIXTURE_SEASON_ID = deterministicUuid("major-browser-season");
const FIXTURE_SLUG = "local-major-browser-2026-08";
const PROFILE = {
  platform: "perfect_world",
  currentSeasonKey: "browser-major-current",
  previousSeasonKey: "browser-major-previous",
  rankOrder: createPerfectWorldRankOrder(),
};
const FIXTURE_RANK = PROFILE.rankOrder[10]!;
const PASSWORD = "Browser-Major-2026!";
const ACCOUNT_KEYS = ["captain", "player1", "player2", "player3", "player4"] as const;
const ACCOUNT_EMAILS = ACCOUNT_KEYS.map((key) => `major-browser-${key}@smail.nju.edu.cn`);
const ACCOUNT_IDS = ACCOUNT_KEYS.map((key) => deterministicUuid(`major-browser-user-${key}`));

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "create";
  if (mode !== "create" && mode !== "cleanup") throw new Error("Major browser fixture mode 必须是 create 或 cleanup。");
  assertDeclaredDatabaseTarget(process.env);
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const apiUrl = assertLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, "service role key");
  const auth = createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });

  try {
    const existingAuthUsers = await findAuthUsers(auth);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await removeFixtureDatabaseRows(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const fixtureAuthUsers = existingAuthUsers.filter((user) => ACCOUNT_EMAILS.includes(user.email ?? ""));
    if (mode === "cleanup") {
      for (const user of fixtureAuthUsers) {
        const result = await auth.auth.admin.deleteUser(user.id);
        if (result.error) throw new Error(`清理 Local 浏览器 Auth fixture 失败：${result.error.message}`);
      }
      console.log(`Major browser fixture cleaned: ${FIXTURE_SLUG}.`);
      return;
    }

    const authIds = new Map<string, string>();
    for (const email of ACCOUNT_EMAILS) {
      const existing = fixtureAuthUsers.find((user) => user.email === email);
      if (existing) {
        const updated = await auth.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
        if (updated.error || !updated.data.user) throw new Error(`准备 Local 浏览器 Auth fixture 失败：${updated.error?.message ?? "unknown"}`);
        authIds.set(email, updated.data.user.id);
      } else {
        const created = await auth.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
        if (created.error || !created.data.user) throw new Error(`创建 Local 浏览器 Auth fixture 失败：${created.error?.message ?? "unknown"}`);
        authIds.set(email, created.data.user.id);
      }
    }

    const writeClient = await pool.connect();
    try {
      await writeClient.query("BEGIN");
      await insertFixture(writeClient, authIds);
      await writeClient.query("COMMIT");
    } catch (error) {
      await writeClient.query("ROLLBACK");
      throw error;
    } finally {
      writeClient.release();
    }

    const tempDir = resolve(process.cwd(), ".agent-tmp");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(resolve(tempDir, "major-browser-credentials.json"), JSON.stringify({
      slug: FIXTURE_SLUG,
      password: PASSWORD,
      accounts: ACCOUNT_KEYS.map((key, index) => ({ key, email: ACCOUNT_EMAILS[index], userId: ACCOUNT_IDS[index] })),
    }, null, 2));
    console.log(`Major browser fixture ready: ${FIXTURE_SLUG}; credentials written to .agent-tmp/major-browser-credentials.json (password intentionally not printed).`);
  } finally {
    await pool.end();
  }
}

async function findAuthUsers(auth: SupabaseClient): Promise<Array<{ id: string; email?: string }>> {
  const users: Array<{ id: string; email?: string }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await auth.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error(`读取 Local Auth fixture 状态失败：${result.error.message}`);
    const pageUsers = result.data.users.map((user) => ({ id: user.id, email: user.email }));
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
  }
  return users;
}

async function removeFixtureDatabaseRows(client: import("pg").PoolClient): Promise<void> {
  await client.query("DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1))", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM matches WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_final_results WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM tournament_honors WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM post_event_adjudications WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_stage_entrants WHERE stage_run_id IN (SELECT id FROM major_stage_runs WHERE season_id = $1)", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_stage_runs WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_prestart_roster_members WHERE entrant_id IN (SELECT id FROM major_prestart_entrants WHERE season_id = $1)", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_prestart_issues WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM team_members WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM teams WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM team_application_active_claims WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM team_application_members WHERE application_id IN (SELECT id FROM team_applications WHERE season_id = $1)", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM team_applications WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM season_registrations WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM audit_logs WHERE season_id = $1", [FIXTURE_SEASON_ID]);
  await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [ACCOUNT_IDS]);
  await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [ACCOUNT_IDS]);
  await client.query("DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])", [ACCOUNT_IDS]);
  await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ACCOUNT_IDS]);
  await client.query("DELETE FROM competitive_platform_seasons WHERE platform = $1 AND season_key = ANY($2::text[])", [PROFILE.platform, [PROFILE.currentSeasonKey, PROFILE.previousSeasonKey]]);
  await client.query("DELETE FROM seasons WHERE id = $1", [FIXTURE_SEASON_ID]);
}

async function insertFixture(client: import("pg").PoolClient, authIds: Map<string, string>): Promise<void> {
  const capabilities = createCapabilities();
  await client.query(
    `INSERT INTO seasons (id, slug, name, kind, status, start_at, registration_deadline, registration_mode, has_captain_voting, has_draft, stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions)
     VALUES ($1, $2, 'Local Major Browser Acceptance', 'Major', 'registration', now() - interval '1 hour', now() + interval '7 days', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
    [FIXTURE_SEASON_ID, FIXTURE_SLUG, capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft, JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig), JSON.stringify(capabilities.teamRegistrationConfig), JSON.stringify(capabilities.affiliationRules), capabilities.minTeamSize, capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions],
  );
  for (const [index, key] of ACCOUNT_KEYS.entries()) {
    const ready = key !== "player1";
    const email = ACCOUNT_EMAILS[index]!;
    await client.query(
      `INSERT INTO users (id, auth_id, email, email_verified_at, display_name, steam_name, perfect_name, perfect_id, steam64, steam_profile_url, qq)
       VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10)`,
      [ACCOUNT_IDS[index], authIds.get(email), email, ready ? `Browser ${key}` : null, ready ? `Browser Steam ${key}` : null, ready ? `Browser Perfect ${key}` : null, ready ? `browser-major-${key}` : null, ready ? `7656119800000000${String(index + 1).padStart(2, "0")}` : null, ready ? `https://steamcommunity.com/id/browser-${key}` : null, ready ? `500000000${String(index + 1).padStart(2, "02")}` : null],
    );
  }
  await client.query(
    `INSERT INTO competitive_platform_seasons (id, platform, season_key, label, rank_order, sort_order, is_current)
     VALUES ($1, $2, $3, 'Browser 当前赛季', $4::json, 1, true), ($5, $2, $6, 'Browser 上一赛季', $4::json, 0, false)`,
    [deterministicUuid("major-browser-platform-current"), PROFILE.platform, PROFILE.currentSeasonKey, JSON.stringify(PROFILE.rankOrder), deterministicUuid("major-browser-platform-previous"), PROFILE.previousSeasonKey],
  );
  const facts = ACCOUNT_KEYS.filter((key) => key !== "player1").flatMap((key) => {
    const userId = ACCOUNT_IDS[ACCOUNT_KEYS.indexOf(key)]!;
    return [
      [deterministicUuid(`major-browser-fact-${key}-historical`), userId, "historical_peak", null, FIXTURE_RANK, "2.00"],
      [deterministicUuid(`major-browser-fact-${key}-previous`), userId, "season_peak", PROFILE.previousSeasonKey, FIXTURE_RANK, "1.90"],
      [deterministicUuid(`major-browser-fact-${key}-current`), userId, "season_peak", PROFILE.currentSeasonKey, FIXTURE_RANK, "1.80"],
    ];
  });
  for (const [id, userId, kind, seasonKey, rank, rating] of facts) {
    await client.query(
      `INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, PROFILE.platform, kind, seasonKey, rank, rating],
    );
  }
  for (const key of ACCOUNT_KEYS.filter((item) => item !== "player1")) {
    const index = ACCOUNT_KEYS.indexOf(key);
    await client.query(
      `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT $1, $2, id, 'enrolled', 'institutional_email', 'approved', 'local-browser-admin', now()
       FROM institutions WHERE moe_institution_code = '4132010284'`,
      [deterministicUuid(`major-browser-education-${key}`), ACCOUNT_IDS[index]],
    );
  }
}

function createCapabilities() {
  const capabilities = createMajorDefaultCapabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = { ...PROFILE };
  return capabilities;
}

function deterministicUuid(scope: string): string {
  const hex = createHash("sha256").update(scope).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} 未设置。`);
  return value.trim();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
