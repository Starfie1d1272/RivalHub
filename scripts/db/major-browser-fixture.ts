import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { createMajor24Capabilities, createMajorDefaultCapabilities } from "../../src/lib/competition/templates";
import { redactText } from "../../src/lib/observability/redact";
import { createPerfectWorldRankOrder } from "../../src/lib/config/perfect-world";
import { teamNameSchema } from "../../src/lib/config/team-config";
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
export const MAJOR_BROWSER_PROFILE_ACCOUNT_KEYS = {
  auth: ["player3"],
  "team-invite": ["player1", "player2"],
  "major-entry": ["captain"],
  education: ["player1", "admin"],
  layout: ["player2", "admin"],
  "major-prestart": ["admin"],
  "major-qualification": ["admin"],
} as const satisfies Record<string, readonly MajorBrowserAccountKey[]>;
export type MajorBrowserScenarioProfile = keyof typeof MAJOR_BROWSER_PROFILE_ACCOUNT_KEYS;

export interface MajorBrowserScenario {
  scenarioId: string;
  profile: MajorBrowserScenarioProfile;
  shortKey: string;
  seasonId: string;
  slug: string;
  seasonName: string;
  password: string;
  authUserIds: string[];
  invitationTeam: {
    id: string;
    slug: string;
    name: string;
    captainUserId: string;
  };
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

export function createMajorBrowserScenario(
  scenarioId: string,
  profile: MajorBrowserScenarioProfile = "major-entry",
): MajorBrowserScenario {
  const definition = scenarioDefinition(scenarioId, profile);
  return {
    scenarioId: definition.scenarioId,
    profile: definition.profile,
    shortKey: definition.shortKey,
    seasonId: definition.seasonId,
    slug: definition.slug,
    seasonName: definition.seasonName,
    password: definition.password,
    authUserIds: [],
    invitationTeam: definition.invitationTeam,
    accounts: definition.accounts,
  };
}

export async function createMajorBrowserScenarioFixture(
  scenarioId: string,
  credentialsPath: string,
  profile: MajorBrowserScenarioProfile = "major-entry",
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<MajorBrowserScenario> {
  const scenario = scenarioDefinition(scenarioId, profile);
  const outputPath = assertCredentialsPath(credentialsPath);
  const staleAuthUserIds = readAuthUserIds(outputPath, scenario.scenarioId, false, scenario.accounts.length);
  const { auth, pool } = openLocalDependencies(env);
  try {
    await runPhase(scenario, "stale fixture cleanup", () => cleanupExistingScenario(scenario, auth, pool, staleAuthUserIds));
    scenario.authUserIds = [];
    const authIds = await runPhase(scenario, "Auth setup", () => createAuthUsers(scenario, auth));
    await runPhase(scenario, "DB setup", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await insertFixture(client, scenario, authIds);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`DB setup failed: ${safeErrorSummary(error)}`, { cause: error });
      } finally {
        client.release();
      }
    });

    mkdirSync(resolve(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
    console.log(`Major browser scenario ready: ${scenario.scenarioId}.`);
    return scenario;
  } catch (error) {
    let cleanupError: unknown;
    try {
      await cleanupExistingScenario(scenario, auth, pool, scenario.authUserIds);
    } catch (candidate) {
      cleanupError = candidate;
    }
    if (cleanupError) {
      throw new Error(`${safeErrorSummary(error)} Cleanup also failed: ${safeErrorSummary(cleanupError)}`, { cause: error });
    }
    throw error;
  } finally {
    await pool.end();
  }
}

export async function cleanupMajorBrowserScenarioFixture(
  scenarioId: string,
  credentialsPath: string,
  profile?: MajorBrowserScenarioProfile,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const manifestPath = assertCredentialsPath(credentialsPath);
  const manifest = readFixtureManifest(manifestPath, scenarioId, true);
  const scenario = scenarioDefinition(scenarioId, profile ?? manifest.profile);
  const authUserIds = readAuthUserIds(manifestPath, scenario.scenarioId, true, scenario.accounts.length);
  const { auth, pool } = openLocalDependencies(env);
  try {
    await runPhase(scenario, "cleanup", () => cleanupExistingScenario(scenario, auth, pool, authUserIds));
    rmSync(manifestPath, { force: true });
    console.log(`Major browser scenario cleaned: ${scenario.scenarioId}.`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "";
  const scenarioId = process.argv[3];
  if ((mode !== "create" && mode !== "cleanup") || !scenarioId) {
    throw new Error("用法：major-browser-fixture.ts create|cleanup <scenario-id> [credentials-path] [profile]");
  }
  assertDeclaredDatabaseTarget(process.env);
  if (mode === "create") {
    const credentialsPath = process.argv[4];
    if (!credentialsPath) throw new Error("create 模式必须提供 credentials-path。");
    await createMajorBrowserScenarioFixture(scenarioId, credentialsPath, parseProfile(process.argv[5]));
  } else {
    const credentialsPath = process.argv[4];
    if (!credentialsPath) throw new Error("cleanup 模式必须提供 credentials-path。");
    await cleanupMajorBrowserScenarioFixture(scenarioId, credentialsPath, parseOptionalProfile(process.argv[5]));
  }
}

function scenarioDefinition(rawScenarioId: string, profile: MajorBrowserScenarioProfile): ScenarioDefinition {
  const scenarioId = normalizeScenarioId(rawScenarioId);
  const shortKey = createHash("sha256").update(scenarioId).digest("hex").slice(0, 12);
  const rankOrder = createPerfectWorldRankOrder();
  const invitationTeamName = `E2E 邀请队伍 ${shortKey}`;
  if (!teamNameSchema.safeParse(invitationTeamName).success) throw new Error("fixture invitation team name exceeds the production contract");
  const player2UserId = deterministicUuid(`${scenarioId}:user:player2`);
  const accounts = MAJOR_BROWSER_PROFILE_ACCOUNT_KEYS[profile].map((key) => ({
    key,
    email: `${shortKey}-${key}@smail.nju.edu.cn`,
    userId: deterministicUuid(`${scenarioId}:user:${key}`),
  }));
  return {
    scenarioId,
    profile,
    shortKey,
    seasonId: deterministicUuid(`${scenarioId}:season`),
    slug: `local-major-${shortKey}`,
    seasonName: "Local Major Browser Acceptance",
    password: FIXTURE_PASSWORD,
    authUserIds: [],
    invitationTeam: {
      id: deterministicUuid(`${scenarioId}:team:invitation`),
      slug: `e2e-invite-${shortKey}`,
      name: invitationTeamName,
      captainUserId: player2UserId,
    },
    accounts,
    platform: `browser-${shortKey}`,
    currentSeasonKey: `current-${shortKey}`,
    previousSeasonKey: `previous-${shortKey}`,
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
    if (created.error || !created.data.user) {
      throw new Error(`Auth setup failed: ${safeErrorSummary(created.error ?? "missing user")}`);
    }
    authIds.set(account.email, created.data.user.id);
    scenario.authUserIds.push(created.data.user.id);
  }
  return authIds;
}

async function cleanupExistingScenario(
  scenario: ScenarioDefinition,
  auth: SupabaseClient,
  pool: Pool,
  authUserIds: readonly string[],
): Promise<void> {
  const failures: string[] = [];
  for (const [phase, operation] of [
    ["Storage", () => removeScenarioStorageObjects(scenario, auth, pool)],
    ["DB", () => removeScenarioDatabaseRows(pool, scenario)],
    ["Auth", () => removeScenarioAuthUsers(auth, authUserIds)],
  ] as const) {
    try {
      await operation();
    } catch (error) {
      failures.push(`${phase}: ${safeErrorSummary(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(`cleanup failed during ${failures.join("; ")}`);
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
  if (error) throw new Error(`Storage cleanup failed: ${safeErrorSummary(error)}`);
}

async function removeScenarioAuthUsers(auth: SupabaseClient, authUserIds: readonly string[]): Promise<void> {
  for (const userId of authUserIds) {
    const result = await auth.auth.admin.deleteUser(userId);
    if (result.error) throw new Error(`Auth cleanup failed: ${safeErrorSummary(result.error)}`);
  }
}

async function removeScenarioDatabaseRows(pool: Pool, scenario: ScenarioDefinition): Promise<void> {
  const ids = scenario.accounts.map((account) => account.userId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await removeFixtureDatabaseRows(client, scenario, ids);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`DB cleanup failed: ${safeErrorSummary(error)}`, { cause: error });
  } finally {
    client.release();
  }
}

async function removeFixtureDatabaseRows(client: PoolClient, scenario: ScenarioDefinition, accountIds: readonly string[]): Promise<void> {
  // Local fixture cleanup is the one operational path allowed to remove
  // append-only provenance rows. Production writes never use this setting.
  await client.query("SET LOCAL session_replication_role = replica");
  const candidateUsers = await client.query<{ user_id: string }>(
    "SELECT DISTINCT user_id FROM competition_entry_participants WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)",
    [scenario.seasonId],
  );
  const fixtureUserIds = [...new Set([...accountIds, ...candidateUsers.rows.map((row) => row.user_id)])];
  const configuredProfileSlug = `e2e-major24-${scenario.shortKey}`;
  await client.query("DELETE FROM audit_logs WHERE season_id = (SELECT id FROM seasons WHERE slug = $1)", [configuredProfileSlug]);
  await client.query("DELETE FROM seasons WHERE slug = $1", [configuredProfileSlug]);
  await client.query("DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1))", [scenario.seasonId]);
  await client.query("DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [scenario.seasonId]);
  await client.query("DELETE FROM matches WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM competition_qualification_entrants WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM competition_qualification_runs WHERE season_id = $1", [scenario.seasonId]);
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
  await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM season_registrations WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM audit_logs WHERE season_id = $1", [scenario.seasonId]);
  await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [fixtureUserIds]);
  await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [fixtureUserIds]);
  await client.query("DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])", [fixtureUserIds]);
  await client.query("DELETE FROM team_invitations WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_memberships WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_captain_changes WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_name_changes WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM team_slug_aliases WHERE team_id IN (SELECT id FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[]))", [accountIds]);
  await client.query("DELETE FROM teams WHERE creator_user_id = ANY($1::uuid[]) OR captain_user_id = ANY($1::uuid[])", [accountIds]);
  await client.query("DELETE FROM steam_profiles WHERE steam64 IN (SELECT steam64 FROM users WHERE id = ANY($1::uuid[]) AND steam64 IS NOT NULL)", [fixtureUserIds]);
  await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixtureUserIds]);
  await deleteCompetitivePlatformCatalog(client, scenario.platform);
  await client.query("DELETE FROM seasons WHERE id = $1", [scenario.seasonId]);
}

async function insertFixture(client: PoolClient, scenario: ScenarioDefinition, authIds: Map<string, string>): Promise<void> {
  if (scenario.profile === "major-entry" || scenario.profile === "layout" || scenario.profile === "major-prestart" || scenario.profile === "major-qualification") await insertMajorSeason(client, scenario);

  for (const [index, account] of scenario.accounts.entries()) {
    const ready = account.key !== "player1";
    if (account.key === "admin") {
      await client.query(
        `INSERT INTO users (id, auth_id, email, email_verified_at, display_name, role)
         VALUES ($1, $2, $3, now(), $4, 'super_admin')`,
        [account.userId, authIds.get(account.email), account.email, "Browser admin"],
      );
    } else {
      const steam64 = ready ? `7656119800000${String(index + 1).padStart(4, "0")}` : null;
      await client.query(
        `INSERT INTO users (id, auth_id, email, email_verified_at, display_name, perfect_name, steam64, qq)
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7)`,
        [account.userId, authIds.get(account.email), account.email, ready ? `Browser ${account.key}` : null, ready ? `Browser Perfect ${account.key}` : null, steam64, ready ? `500000${String(index + 1).padStart(4, "0")}` : null],
      );
      if (steam64) {
        await client.query(
          `INSERT INTO steam_profiles (steam64, persona_name, profile_url, avatar_url)
           VALUES ($1, $2, $3, NULL)`,
          [steam64, `Browser Steam ${account.key}`, `https://steamcommunity.com/profiles/${steam64}`],
        );
      }
    }
  }

  if (scenario.profile === "education") {
    await insertRejectedChsiVerification(client, scenario);
    return;
  }
  if (scenario.profile === "team-invite") await insertInvitationTeam(client, scenario);
  if (scenario.profile === "major-entry" || scenario.profile === "layout" || scenario.profile === "major-prestart" || scenario.profile === "major-qualification") {
    await seedCompetitivePlatformCatalog(client, scenario.platform, [
      { seasonKey: scenario.previousSeasonKey, label: "Browser 上一赛季", sortOrder: 0, isCurrent: false },
      { seasonKey: scenario.currentSeasonKey, label: "Browser 当前赛季", sortOrder: 1, isCurrent: true },
    ], scenario.rankOrder, "Rating", "browser-perfect-world");
    if (scenario.profile === "major-qualification") await insertQualificationCandidateUsers(client, scenario);
    await insertRankFacts(client, scenario);
    await insertEducationVerifications(client, scenario);
    if (scenario.profile === "major-qualification") {
      await insertQualificationCandidateFacts(client, scenario);
      await insertQualificationCandidates(client, scenario);
    }
  }
}

async function insertMajorSeason(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const capabilities = createCapabilities(scenario);
  await client.query(
    `INSERT INTO seasons (id, slug, name, kind, competition_template, status, registration_opens_at, registration_opened_at, registration_closes_at, registration_mode, has_captain_voting, has_draft, stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions)
     VALUES ($1, $2, $3, 'Major', 'major', 'registration', now() - interval '1 hour', now() - interval '1 hour', CASE WHEN $15 THEN now() - interval '1 minute' ELSE now() + interval '7 days' END, $4, $5, $6, $7::json, $8::json, $9::json, $10::json, $11, $12, $13, $14::text[])`,
    [scenario.seasonId, scenario.slug, scenario.seasonName, capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft, JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig), JSON.stringify(capabilities.teamRegistrationConfig), JSON.stringify(capabilities.affiliationRules), capabilities.minTeamSize, capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions, scenario.profile === "major-qualification"],
  );
}

async function insertInvitationTeam(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const captain = scenario.accounts.find((account) => account.key === "player2");
  if (!captain) throw new Error("team-invite fixture 缺少 player2 captain。");
  await client.query(
    `INSERT INTO teams (id, slug, name, description, creator_user_id, captain_user_id)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [scenario.invitationTeam.id, scenario.invitationTeam.slug, scenario.invitationTeam.name, "验证 direct invitation 的预置长期队伍", captain.userId],
  );
  await client.query(
    "INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-browser-fixture')",
    [scenario.invitationTeam.id, captain.userId],
  );
  await client.query(
    "INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'active', $2)",
    [scenario.invitationTeam.id, captain.userId],
  );
  await client.query(
    "INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-browser-fixture')",
    [scenario.invitationTeam.id, scenario.invitationTeam.name],
  );
}

async function insertRankFacts(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const accounts = scenario.accounts.filter(({ key }) => key !== "player1" && key !== "admin");
  const candidateUsers = scenario.profile === "major-qualification" ? qualificationCandidateUsers(scenario) : [];
  const facts = [...accounts.map((account) => ({ key: account.key, userId: account.userId })), ...candidateUsers].flatMap(({ key, userId }) => [
    [deterministicUuid(`${scenario.scenarioId}:fact:${key}:historical`), userId, "historical_peak", null, scenario.fixtureRank, "2.00", scenario.fixtureStars],
    [deterministicUuid(`${scenario.scenarioId}:fact:${key}:previous`), userId, "season_peak", scenario.previousSeasonKey, scenario.fixtureRank, "1.90", scenario.fixtureStars],
    [deterministicUuid(`${scenario.scenarioId}:fact:${key}:current`), userId, "season_peak", scenario.currentSeasonKey, scenario.fixtureRank, "1.80", scenario.fixtureStars],
  ]);
  if (facts.length === 0) return;
  const { sql: valuesSql, values } = parameterizedValues(facts.map(([id, userId, kind, seasonKey, rank, rating, stars]) => [
    id, userId, scenario.platform, kind, seasonKey, rank, rating, stars,
  ]));
  await client.query(
    `INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating, stars) VALUES ${valuesSql}`,
    values,
  );
}

async function insertEducationVerifications(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const verifications = scenario.accounts
    .filter(({ key }) => key !== "player1" && key !== "admin")
    .map((account) => [deterministicUuid(`${scenario.scenarioId}:education:${account.key}`), account.userId]);
  await insertApprovedInstitutionalEmailVerifications(client, verifications);
}

function qualificationCandidateUsers(scenario: ScenarioDefinition): Array<{ key: string; userId: string; email: string }> {
  return Array.from({ length: 30 }, (_, teamIndex) => Array.from({ length: 5 }, (_, playerIndex) => {
    const key = `candidate-${teamIndex + 1}-${playerIndex + 1}`;
    return {
      key,
      userId: deterministicUuid(`${scenario.scenarioId}:user:${key}`),
      email: `${scenario.shortKey}-${key}@smail.nju.edu.cn`,
    };
  })).flat();
}

async function insertQualificationCandidateUsers(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const rows = qualificationCandidateUsers(scenario).map((candidate, index) => {
    const steam64 = `765611980${String(index + 1).padStart(8, "0")}`;
    return [candidate.userId, candidate.email, `Candidate ${candidate.key}`, `Candidate Perfect ${candidate.key}`, steam64, `743${String(index + 1).padStart(7, "0")}`];
  });
  const { sql: valuesSql, values } = parameterizedValues(rows, ["uuid", "text", "text", "text", "text", "text"]);
  await client.query(
    `INSERT INTO users (id, email, email_verified_at, display_name, perfect_name, steam64, qq)
     SELECT v.id::uuid, v.email, now(), v.display_name, v.perfect_name, v.steam64, v.qq
     FROM (VALUES ${valuesSql}) AS v(id, email, display_name, perfect_name, steam64, qq)`,
    values,
  );
}

async function insertQualificationCandidateFacts(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const verifications = qualificationCandidateUsers(scenario)
    .map((candidate) => [deterministicUuid(`${scenario.scenarioId}:education:${candidate.key}`), candidate.userId]);
  await insertApprovedInstitutionalEmailVerifications(client, verifications);
}

async function insertApprovedInstitutionalEmailVerifications(client: PoolClient, rows: readonly (readonly unknown[])[]): Promise<void> {
  if (rows.length === 0) return;
  const { sql: valuesSql, values } = parameterizedValues(rows, ["uuid", "uuid"]);
  await client.query(
    `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
     SELECT v.id::uuid, v.user_id::uuid, i.id, 'enrolled', 'institutional_email', 'approved', 'local-browser-admin', now()
     FROM (VALUES ${valuesSql}) AS v(id, user_id)
     JOIN institutions i ON i.moe_institution_code = '4132010284'`,
    values,
  );
}

async function insertQualificationCandidates(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const candidates = qualificationCandidateUsers(scenario);
  const entries: unknown[][] = [];
  const representativeChanges: unknown[][] = [];
  const participants: unknown[][] = [];
  const revisions: unknown[][] = [];
  const rosterMembers: unknown[][] = [];
  for (let teamIndex = 0; teamIndex < 30; teamIndex += 1) {
    const entryId = deterministicUuid(`${scenario.scenarioId}:entry:${teamIndex + 1}`);
    const revisionId = deterministicUuid(`${scenario.scenarioId}:entry:${teamIndex + 1}:revision:1`);
    const members = candidates.slice(teamIndex * 5, teamIndex * 5 + 5);
    const representative = members[0]!;
    entries.push([entryId, scenario.seasonId, `Qualification Entry ${String(teamIndex + 1).padStart(2, "0")}`, `https://local.test/${entryId}.png`, representative.userId, `fixture-${entryId}`, revisionId]);
    representativeChanges.push([entryId, representative.userId]);
    revisions.push([revisionId, entryId]);
    for (const member of members) {
      participants.push([entryId, member.userId, representative.userId]);
      rosterMembers.push([entryId, revisionId, member.userId, true]);
    }
  }

  const entryValues = parameterizedValues(entries, ["uuid", "uuid", "text", "text", "uuid", "text", "uuid"]);
  await client.query(
    `INSERT INTO competition_entries (
       id, competition_id, source, name, logo_url, representative_user_id, perfect_team_id,
       current_roster_revision_id, approved_roster_revision_id, registration_status, submitted_at, reviewed_at
     )
     SELECT v.id::uuid, v.competition_id::uuid, 'event_native', v.name, v.logo_url, v.representative_user_id::uuid,
       v.perfect_team_id, v.revision_id::uuid, v.revision_id::uuid, 'approved', now(), now()
     FROM (VALUES ${entryValues.sql}) AS v(id, competition_id, name, logo_url, representative_user_id, perfect_team_id, revision_id)`,
    entryValues.values,
  );

  const representativeValues = parameterizedValues(representativeChanges, ["uuid", "uuid"]);
  await client.query(
    `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
     SELECT v.entry_id::uuid, NULL, v.user_id::uuid, 'local-browser-fixture'
     FROM (VALUES ${representativeValues.sql}) AS v(entry_id, user_id)`,
    representativeValues.values,
  );

  const participantValues = parameterizedValues(participants, ["uuid", "uuid", "uuid"]);
  await client.query(
    `INSERT INTO competition_entry_participants (entry_id, user_id, status, confirmed_at, invited_by_user_id)
     SELECT v.entry_id::uuid, v.user_id::uuid, 'confirmed', now(), v.invited_by_user_id::uuid
     FROM (VALUES ${participantValues.sql}) AS v(entry_id, user_id, invited_by_user_id)`,
    participantValues.values,
  );

  const revisionValues = parameterizedValues(revisions, ["uuid", "uuid"]);
  await client.query(
    `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
     SELECT v.id::uuid, v.entry_id::uuid, 1, 'approved', 'local-browser-fixture', now()
     FROM (VALUES ${revisionValues.sql}) AS v(id, entry_id)`,
    revisionValues.values,
  );

  const rosterValues = parameterizedValues(rosterMembers, ["uuid", "uuid", "uuid", "boolean"]);
  await client.query(
    `INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter)
     SELECT v.revision_id::uuid, p.id, v.user_id::uuid, v.is_primary
     FROM (VALUES ${rosterValues.sql}) AS v(entry_id, revision_id, user_id, is_primary)
     JOIN competition_entry_participants p ON p.entry_id = v.entry_id::uuid AND p.user_id = v.user_id::uuid`,
    rosterValues.values,
  );
}

function parameterizedValues(rows: readonly (readonly unknown[])[], casts?: readonly string[]): { sql: string; values: unknown[] } {
  const columnCount = rows[0]?.length;
  if (!columnCount || rows.some((row) => row.length !== columnCount) || (casts && casts.length !== columnCount)) {
    throw new Error("fixture bulk insert rows must have the same non-zero column count");
  }
  const values: unknown[] = [];
  const sql = rows.map((row) => `(${row.map((value, columnIndex) => {
    values.push(value);
    return `$${values.length}${casts ? `::${casts[columnIndex]}` : ""}`;
  }).join(", ")})`).join(", ");
  return { sql, values };
}

async function insertRejectedChsiVerification(client: PoolClient, scenario: ScenarioDefinition): Promise<void> {
  const player = scenario.accounts.find(({ key }) => key === "player1");
  if (!player) throw new Error("education fixture 缺少 player1。");
  await client.query(
    `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, evidence_code, status, reviewed_by, reviewed_at, review_note)
     SELECT $1, $2, id, 'enrolled', 'chsi_enrollment_report', $3, 'rejected', 'local-browser-admin', now(), '在线验证报告已过期，无法在线验证。'
     FROM institutions WHERE moe_institution_code = '4132010284'`,
    [deterministicUuid(scenario.scenarioId + ":education:rejected-chsi"), player.userId, "ABCD1234EFGH5678"],
  );
}

function createCapabilities(scenario: ScenarioDefinition) {
  const capabilities = scenario.profile === "major-qualification" ? createMajor24Capabilities() : createMajorDefaultCapabilities();
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
  } catch (error) {
    throw new Error(`Major browser scenario ${scenario.scenarioId} failed during ${phase}: ${safeErrorSummary(error)}`, { cause: error });
  }
}

function readAuthUserIds(path: string, scenarioId: string, required = false, expectedCount: number = ACCOUNT_KEYS.length): string[] {
  if (!existsSync(path)) {
    if (required) throw new Error(`fixture credentials missing for scenario ${scenarioId}.`);
    return [];
  }
  try {
    const value = readFixtureManifest(path, scenarioId, required);
    if (value.authUserIds.length !== expectedCount || !value.authUserIds.every((id) => typeof id === "string" && isUuid(id))) {
      throw new Error("invalid fixture credentials");
    }
    return value.authUserIds;
  } catch (error) {
    throw new Error(`fixture credentials invalid for scenario ${scenarioId}: ${safeErrorSummary(error)}`, { cause: error });
  }
}

function readFixtureManifest(path: string, scenarioId: string, required: boolean): { profile: MajorBrowserScenarioProfile; authUserIds: string[] } {
  if (!existsSync(path)) {
    if (required) throw new Error(`fixture credentials missing for scenario ${scenarioId}.`);
    return { profile: "major-entry", authUserIds: [] };
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { scenarioId?: unknown; profile?: unknown; authUserIds?: unknown };
    const profile = parseProfile(typeof value.profile === "string" ? value.profile : undefined);
    if (value.scenarioId !== scenarioId || !Array.isArray(value.authUserIds)) throw new Error("invalid fixture credentials");
    return { profile, authUserIds: value.authUserIds.filter((id): id is string => typeof id === "string") };
  } catch (error) {
    throw new Error(`fixture credentials invalid for scenario ${scenarioId}: ${safeErrorSummary(error)}`, { cause: error });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "operation failed";
  return redactText(message, 240) || "operation failed";
}

function assertCredentialsPath(value: string): string {
  const outputPath = resolve(process.cwd(), value);
  const relative = outputPath.startsWith(`${TEMP_ROOT}/`) ? outputPath.slice(TEMP_ROOT.length + 1) : "";
  if (!relative || relative.includes("..") || relative.endsWith("/")) throw new Error("credentials-path 必须位于 .agent-tmp 内。 ");
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

function parseProfile(value: string | undefined): MajorBrowserScenarioProfile {
  const profile = value?.trim() || "major-entry";
  if (Object.hasOwn(MAJOR_BROWSER_PROFILE_ACCOUNT_KEYS, profile)) return profile as MajorBrowserScenarioProfile;
  throw new Error(`未知 browser fixture profile: ${profile}`);
}

function parseOptionalProfile(value: string | undefined): MajorBrowserScenarioProfile | undefined {
  return value?.trim() ? parseProfile(value) : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Major browser scenario failed.");
    process.exit(1);
  });
}
