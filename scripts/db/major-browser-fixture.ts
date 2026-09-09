import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { createMajorDefaultCapabilities } from "../../src/lib/competition/templates";
import { createPerfectWorldRankOrder } from "../../src/lib/config/perfect-world";
import { assertDeclaredDatabaseTarget, assertLocalDatabaseUrl, assertLocalHttpUrl } from "./local-environment";
import {
  deleteCompetitivePlatformCatalog,
  seedCompetitivePlatformCatalog,
} from "../../tests/integration/db/harness/competitive-catalog-fixtures";

const PLAYER_ACCOUNT_KEYS = ["captain", "player1", "player2", "player3", "player4"] as const;
const ACCOUNT_KEYS = [...PLAYER_ACCOUNT_KEYS, "admin"] as const;
const FIXTURE_PASSWORD = "Browser-Major-2026!";
const TEMP_ROOT = resolve(process.cwd(), ".agent-tmp");

export type MajorBrowserAccountKey = (typeof ACCOUNT_KEYS)[number];

export interface MajorBrowserScenario {
  scenarioId: string;
  seasonId: string;
  slug: string;
  seasonName: string;
  password: string;
  accounts: Array<{ key: MajorBrowserAccountKey; email: string; userId: string }>;
}

interface ScenarioDefinition extends MajorBrowserScenario {
  platform: string;
  currentSeasonKey: string;
  previousSeasonKey: string;
  rankOrder: readonly string[];
  fixtureRank: string;
  fixtureStars: number;
}

export function createMajorBrowserScenario(scenarioId: string): MajorBrowserScenario {
  const definition = scenarioDefinition(scenarioId);
  return {
    scenarioId: definition.scenarioId,
    seasonId: definition.seasonId,
    slug: definition.slug,
    seasonName: definition.seasonName,
    password: definition.password,
    accounts: definition.accounts,
  };
}

export async function createMajorBrowserScenarioFixture(
  scenarioId: string,
  credentialsPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<MajorBrowserScenario> {
  const scenario = scenarioDefinition(scenarioId);
  const outputPath = assertCredentialsPath(credentialsPath);
  const { auth, pool } = openLocalDependencies(env);
  try {
    await runPhase(scenario, "stale fixture cleanup", () => cleanupExistingScenario(scenario, auth, pool));
    const authIds = await runPhase(scenario, "Auth setup", () => createAuthUsers(scenario, auth));
    await runPhase(scenario, "DB setup", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await insertFixture(client, scenario, authIds);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
        throw new Error("DB setup failed");
      } finally {
        client.release();
      }
    });

    mkdirSync(resolve(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
    console.log(`Major browser scenario ready: ${scenario.scenarioId}.`);
    return scenario;
  } catch (error) {
    try {
      await cleanupExistingScenario(scenario, auth, pool);
    } catch {
      // The original safe phase is more useful than a second cleanup error.
    }
    throw error;
  } finally {
    await pool.end();
  }
}

export async function cleanupMajorBrowserScenarioFixture(
  scenarioId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const scenario = scenarioDefinition(scenarioId);
  const { auth, pool } = openLocalDependencies(env);
  try {
    await runPhase(scenario, "cleanup", () => cleanupExistingScenario(scenario, auth, pool));
    console.log(`Major browser scenario cleaned: ${scenario.scenarioId}.`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "";
  const scenarioId = process.argv[3];
  if ((mode !== "create" && mode !== "cleanup") || !scenarioId) {
    throw new Error("用法：major-browser-fixture.ts create|cleanup <scenario-id> [credentials-path]");
  }
  assertDeclaredDatabaseTarget(process.env);
  if (mode === "create") {
    const credentialsPath = process.argv[4];
    if (!credentialsPath) throw new Error("create 模式必须提供 credentials-path。");
    await createMajorBrowserScenarioFixture(scenarioId, credentialsPath);
  } else {
    await cleanupMajorBrowserScenarioFixture(scenarioId);
  }
}

function scenarioDefinition(rawScenarioId: string): ScenarioDefinition {
  const scenarioId = normalizeScenarioId(rawScenarioId);
  const suffix = createHash("sha256").update(scenarioId).digest("hex").slice(0, 12);
  const rankOrder = createPerfectWorldRankOrder();
  const accounts = ACCOUNT_KEYS.map((key) => ({
    key,
    email: `${scenarioId}-${key}@smail.nju.edu.cn`,
    userId: deterministicUuid(`${scenarioId}:user:${key}`),
  }));
  return {
    scenarioId,
    seasonId: deterministicUuid(`${scenarioId}:season`),
    slug: `local-major-${suffix}`,
    seasonName: "Local Major Browser Acceptance",
    password: FIXTURE_PASSWORD,
    accounts,
    platform: `browser-${suffix}`,
    currentSeasonKey: `current-${suffix}`,
    previousSeasonKey: `previous-${suffix}`,
    rankOrder,
    fixtureRank: rankOrder[10]!,
    fixtureStars: 10,
  };
}

function openLocalDependencies(env: Readonly<Record<string, string | undefined>>): { auth: SupabaseClient; pool: Pool } {
  const databaseUrl = assertLocalDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
  const apiUrl = assertLocalHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required(env.SUPABASE_SERVICE_ROLE_KEY, "service role key");
  return {
    auth: createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }),
    pool: new Pool({ connectionString: databaseUrl, ssl: false, max: 1 }),
  };
}

async function createAuthUsers(scenario: ScenarioDefinition, auth: SupabaseClient): Promise<Map<string, string>> {
  const authIds = new Map<string, string>();
  for (const account of scenario.accounts) {
    const created = await auth.auth.admin.createUser({
      email: account.email,
      password: scenario.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error("Auth setup failed");
    authIds.set(account.email, created.data.user.id);
  }
  return authIds;
}

async function cleanupExistingScenario(scenario: ScenarioDefinition, auth: SupabaseClient, pool: Pool): Promise<void> {
  const failures: string[] = [];
  for (const [phase, operation] of [
    ["Storage", () => removeScenarioStorageObjects(scenario, auth, pool)],
    ["DB", () => removeScenarioDatabaseRows(pool, scenario)],
    ["Auth", () => removeScenarioAuthUsers(scenario, auth)],
  ] as const) {
    try {
      await operation();
    } catch {
      failures.push(phase);
    }
  }
  if (failures.length > 0) throw new Error(`cleanup failed during ${failures.join(", ")}`);
}

async function removeScenarioStorageObjects(scenario: ScenarioDefinition, auth: SupabaseClient, pool: Pool): Promise<void> {
  const client = await pool.connect();
  let keys: string[] = [];
  try {
    const result = await client.query<{ evidence_object_key: string }>(
      "SELECT evidence_object_key FROM education_verifications WHERE user_id = ANY($1::uuid[]) AND evidence_object_key IS NOT NULL",
      [scenario.accounts.map((account) => account.userId)],
    );
    keys = result.rows.map((row) => row.evidence_object_key);
  } finally {
    client.release();
  }
  if (keys.length === 0) return;
  const { error } = await auth.storage.from("education-evidence").remove(keys);
  if (error) throw new Error("Storage cleanup failed");
}

async function removeScenarioAuthUsers(scenario: ScenarioDefinition, auth: SupabaseClient): Promise<void> {
  const existing = await findAuthUsers(auth);
  for (const user of existing.filter((candidate) => scenario.accounts.some((account) => account.email === candidate.email))) {
    const result = await auth.auth.admin.deleteUser(user.id);
    if (result.error) throw new Error("Auth cleanup failed");
  }
}

async function findAuthUsers(auth: SupabaseClient): Promise<Array<{ id: string; email?: string }>> {
  const users: Array<{ id: string; email?: string }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await auth.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Auth list failed");
    const pageUsers = result.data.users.map((user) => ({ id: user.id, email: user.email }));
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
  }
  return users;
}

async function removeScenarioDatabaseRows(pool: Pool, scenario: ScenarioDefinition): Promise<void> {
  const ids = scenario.accounts.map((account) => account.userId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await removeFixtureDatabaseRows(client, scenario, ids);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("DB cleanup failed");
  } finally {
    client.release();
  }
}

async function removeFixtureDatabaseRows(client: PoolClient, scenario: ScenarioDefinition, accountIds: readonly string[]): Promise<void> {
  // Local fixture cleanup is the one operational path allowed to remove
  // append-only provenance rows. Production writes never use this setting.
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query("DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1))", [scenario.seasonId]);
  await client.query("DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM matches WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM major_final_results WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM tournament_honors WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM post_event_adjudications WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM major_stage_entrants WHERE stage_run_id IN (SELECT id FROM major_stage_runs WHERE season_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM major_stage_runs WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_active_claims WHERE competition_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_submissions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN (SELECT id FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1))", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1))", [scenario.seasonId]);
  await client.query("DELETE FROM event_rosters WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_participants WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entry_legacy_identities WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM major_prestart_issues WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM season_registrations WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM audit_logs WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [accountIds]);
  await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [accountIds]);
  await client.query("DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])", [accountIds]);
  await client.query("DELETE FROM team_invitations WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_memberships WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_captain_changes WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_name_changes WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_slug_aliases WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[])", [accountIds]);
  await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [accountIds]);
  await deleteCompetitivePlatformCatalog(client, scenario.platform);
  await client.query("DELETE FROM seasons WHERE id = $1", [scenario.seasonId]);
}

async function insertFixture(client: PoolClient, scenario: ScenarioDefinition, authIds: Map<string, string>): Promise<void> {
  const capabilities = createCapabilities(scenario);
  await client.query(
    `INSERT INTO seasons (id, slug, name, kind, status, registration_opens_at, registration_opened_at, registration_closes_at, registration_mode, has_captain_voting, has_draft, stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions)
     VALUES ($1, $2, $3, 'Major', 'registration', now() - interval '1 hour', now() - interval '1 hour', now() + interval '7 days', $4, $5, $6, $7::json, $8::json, $9::json, $10::json, $11, $12, $13, $14::text[])`,
    [scenario.seasonId, scenario.slug, scenario.seasonName, capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft, JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig), JSON.stringify(capabilities.teamRegistrationConfig), JSON.stringify(capabilities.affiliationRules), capabilities.minTeamSize, capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions],
  );
  for (const [index, key] of PLAYER_ACCOUNT_KEYS.entries()) {
    const ready = key !== "player1";
    const account = scenario.accounts.find((candidate) => candidate.key === key)!;
    await client.query(
      `INSERT INTO users (id, auth_id, email, email_verified_at, display_name, steam_name, perfect_name, steam64, steam_profile_url, qq)
       VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9)`,
      [account.userId, authIds.get(account.email), account.email, ready ? `Browser ${key}` : null, ready ? `Browser Steam ${key}` : null, ready ? `Browser Perfect ${key}` : null, ready ? `7656119800000${String(index + 1).padStart(4, "0")}` : null, ready ? `https://steamcommunity.com/id/${scenario.scenarioId}-${key}` : null, ready ? `500000${String(index + 1).padStart(4, "0")}` : null],
    );
  }
  const admin = scenario.accounts.find((account) => account.key === "admin")!;
  await client.query(
    `INSERT INTO users (id, auth_id, email, email_verified_at, display_name, role)
     VALUES ($1, $2, $3, now(), $4, 'super_admin')`,
    [admin.userId, authIds.get(admin.email), admin.email, "Browser admin"],
  );
  await seedCompetitivePlatformCatalog(client, scenario.platform, [
    { seasonKey: scenario.previousSeasonKey, label: "Browser 上一赛季", sortOrder: 0, isCurrent: false },
    { seasonKey: scenario.currentSeasonKey, label: "Browser 当前赛季", sortOrder: 1, isCurrent: true },
  ], scenario.rankOrder, "Rating", "browser-perfect-world");
  const facts = PLAYER_ACCOUNT_KEYS.filter((key) => key !== "player1").flatMap((key) => {
    const userId = scenario.accounts.find((account) => account.key === key)!.userId;
    return [
      [deterministicUuid(`${scenario.scenarioId}:fact:${key}:historical`), userId, "historical_peak", null, scenario.fixtureRank, "2.00", scenario.fixtureStars],
      [deterministicUuid(`${scenario.scenarioId}:fact:${key}:previous`), userId, "season_peak", scenario.previousSeasonKey, scenario.fixtureRank, "1.90", scenario.fixtureStars],
      [deterministicUuid(`${scenario.scenarioId}:fact:${key}:current`), userId, "season_peak", scenario.currentSeasonKey, scenario.fixtureRank, "1.80", scenario.fixtureStars],
    ];
  });
  for (const [id, userId, kind, seasonKey, rank, rating, stars] of facts) {
    await client.query(
      "INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating, stars) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, userId, scenario.platform, kind, seasonKey, rank, rating, stars],
    );
  }
  for (const key of PLAYER_ACCOUNT_KEYS.filter((item) => item !== "player1")) {
    const account = scenario.accounts.find((candidate) => candidate.key === key)!;
    await client.query(
      `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT $1, $2, id, 'enrolled', 'institutional_email', 'approved', 'local-browser-admin', now()
       FROM institutions WHERE moe_institution_code = '4132010284'`,
      [deterministicUuid(`${scenario.scenarioId}:education:${key}`), account.userId],
    );
  }
}

function createCapabilities(scenario: ScenarioDefinition) {
  const capabilities = createMajorDefaultCapabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = {
    platform: scenario.platform,
    currentSeasonKey: scenario.currentSeasonKey,
    previousSeasonKey: scenario.previousSeasonKey,
    rankOrder: [...scenario.rankOrder],
  };
  return capabilities;
}

async function runPhase<T>(scenario: ScenarioDefinition, phase: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(`Major browser scenario ${scenario.scenarioId} failed during ${phase}.`);
  }
}

function assertCredentialsPath(value: string): string {
  const outputPath = resolve(process.cwd(), value);
  const relative = outputPath.startsWith(`${TEMP_ROOT}/`) ? outputPath.slice(TEMP_ROOT.length + 1) : "";
  if (!relative || relative.includes("..")) throw new Error("credentials-path 必须位于 .agent-tmp 内。 ");
  return outputPath;
}

function normalizeScenarioId(value: string): string {
  const scenarioId = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(scenarioId)) throw new Error("scenario-id 无效。 ");
  return scenarioId;
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
  console.error(error instanceof Error ? error.message : "Major browser scenario failed.");
  process.exit(1);
});
