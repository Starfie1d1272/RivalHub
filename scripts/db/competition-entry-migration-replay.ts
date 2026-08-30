import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const local = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(local.hostname)) {
  throw new Error("迁移回放只允许 Local Supabase loopback 数据库。");
}

const databaseName = `rivalhub_0017_${randomUUID().replaceAll("-", "")}`;
const maintenance = new URL(databaseUrl);
maintenance.pathname = "/postgres";

async function runMigration(client: Client, name: string): Promise<void> {
  const source = readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`${name} 回放失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function insertRivalsFixture(client: Client): Promise<{ seasonId: string; teamIds: string[] }> {
  const seasonId = randomUUID();
  const teamIds = Array.from({ length: 8 }, () => randomUUID());
  const userIds = Array.from({ length: 56 }, () => randomUUID());
  const registrationIds = Array.from({ length: 56 }, () => randomUUID());
  await client.query(
    "INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, $2, '2026 Spring Rivals', 'Rivals', 'finished')",
    [seasonId, `replay-rivals-${seasonId}`],
  );
  for (let index = 0; index < userIds.length; index += 1) {
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userIds[index], `rivals-${index}-${seasonId}@local.test`]);
    await client.query(
      `INSERT INTO season_registrations (
        id, user_id, season_id, primary_position, secondary_position, peak_rank, peak_rank_season,
        peak_rating, current_season_peak_rank, current_rating, gameplay_style
      ) VALUES ($1, $2, $3, 'igl', 'awper', 'A', '2026S', 1000, 'A', 1000, 'fixture')`,
      [registrationIds[index], userIds[index], seasonId],
    );
  }
  for (let teamIndex = 0; teamIndex < teamIds.length; teamIndex += 1) {
    const captain = teamIndex * 7;
    await client.query(
      "INSERT INTO teams (id, season_id, name, captain_registration_id, captain_user_id, draft_order) VALUES ($1, $2, $3, $4, $5, $6)",
      [teamIds[teamIndex], seasonId, `Rivals ${teamIndex + 1}`, registrationIds[captain], userIds[captain], teamIndex + 1],
    );
    for (let offset = 0; offset < 7; offset += 1) {
      await client.query(
        "INSERT INTO team_members (id, team_id, registration_id, season_id, user_id, is_starter) VALUES ($1, $2, $3, $4, $5, $6)",
        [randomUUID(), teamIds[teamIndex], registrationIds[captain + offset], seasonId, userIds[captain + offset], offset < 5],
      );
    }
  }
  for (let index = 0; index < 42; index += 1) {
    const teamA = teamIds[index % 8]!;
    const teamB = teamIds[(index + 1 + Math.floor(index / 8)) % 8]!;
    await client.query(
      "INSERT INTO matches (id, season_id, team_a_id, team_b_id, stage, round, status, score_a, score_b, completed_at) VALUES ($1, $2, $3, $4, 'group', $5, 'finished', 13, 11, now())",
      [randomUUID(), seasonId, teamA, teamB, index + 1],
    );
  }
  return { seasonId, teamIds };
}

async function insertMajorReconciliationFixture(client: Client): Promise<void> {
  const historicSeason = randomUUID();
  const currentSeason = randomUUID();
  const rejectedUser = randomUUID();
  const identityCaptain = randomUUID();
  const identityMember = randomUUID();
  const invitedUser = randomUUID();
  const rejectedApplication = randomUUID();
  const activeApplication = randomUUID();
  const identityApplication = randomUUID();
  const invitedApplication = randomUUID();
  const activeTeam = randomUUID();
  const identityTeam = randomUUID();
  await client.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft) VALUES ($1,$2,'Historic Major','Major','finished','team',false,false),($3,$4,'Current Major','Major','registration','team',false,false)", [historicSeason, `replay-historic-${historicSeason}`, currentSeason, `replay-current-${currentSeason}`]);
  for (const [id, label] of [[rejectedUser, "rejected"], [identityCaptain, "identity-captain"], [identityMember, "identity-member"], [invitedUser, "invited"]] as const) {
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `${label}-${id}@local.test`]);
  }
  await client.query(
    `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
     VALUES ($1,$2,'Returned for changes',$3,'rejected'), ($4,$5,'Current commitment',$3,'approved'), ($6,$5,'Application identity',$7,'approved'), ($8,$5,'Invitation only',$9,'draft')`,
    [rejectedApplication, historicSeason, rejectedUser, activeApplication, currentSeason, identityApplication, identityCaptain, invitedApplication, invitedUser],
  );
  await client.query(
    `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
     VALUES ($1,$2,$3,$3,'confirmed',now()), ($4,$5,$3,$3,'confirmed',now()),
            ($6,$7,$8,$8,'confirmed',now()), ($9,$7,$10,$8,'confirmed',now()),
            ($11,$12,$13,$13,'invited',NULL)`,
    [randomUUID(), rejectedApplication, rejectedUser, randomUUID(), activeApplication, randomUUID(), identityApplication, identityCaptain, randomUUID(), identityMember, randomUUID(), invitedApplication, invitedUser],
  );
  await client.query(
    "INSERT INTO team_application_active_claims (season_id, user_id, application_id) VALUES ($1,$2,$3),($1,$4,$5)",
    [currentSeason, rejectedUser, activeApplication, invitedUser, invitedApplication],
  );
  await client.query(
    "INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id) VALUES ($1,$2,'Current commitment',$3,$4),($5,$2,'Application identity',$6,$7)",
    [activeTeam, currentSeason, rejectedUser, activeApplication, identityTeam, identityCaptain, identityApplication],
  );
  const activeMember = await client.query<{ id: string }>("SELECT id FROM team_application_members WHERE application_id = $1", [activeApplication]);
  const identityMembers = await client.query<{ id: string; user_id: string }>("SELECT id, user_id FROM team_application_members WHERE application_id = $1 ORDER BY user_id", [identityApplication]);
  await client.query("INSERT INTO team_members (id, team_id, season_id, user_id, team_application_member_id) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), activeTeam, currentSeason, rejectedUser, activeMember.rows[0]!.id]);
  for (const member of identityMembers.rows) await client.query("INSERT INTO team_members (id, team_id, season_id, user_id, team_application_member_id) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), identityTeam, currentSeason, member.user_id, member.id]);
}

async function assertReplay(client: Client, rivals: { seasonId: string; teamIds: string[] }): Promise<void> {
  const rivalsEntries = await client.query<{ entries: string; participants: string; frozen: string; matches: string; linked: string }>(`
    SELECT
      (SELECT count(*) FROM competition_entries WHERE competition_id = $1)::text AS entries,
      (SELECT count(*) FROM competition_entry_participants p JOIN competition_entries e ON e.id = p.entry_id WHERE e.competition_id = $1)::text AS participants,
      (SELECT count(*) FROM event_roster_members m JOIN event_rosters r ON r.id = m.event_roster_id JOIN competition_entries e ON e.id = r.entry_id WHERE e.competition_id = $1)::text AS frozen,
      (SELECT count(*) FROM matches WHERE season_id = $1)::text AS matches,
      (SELECT count(*) FROM competition_entries WHERE competition_id = $1 AND (source <> 'event_native' OR team_id IS NOT NULL))::text AS linked
  `, [rivals.seasonId]);
  const facts = rivalsEntries.rows[0];
  if (!facts || facts.entries !== "8" || facts.participants !== "56" || facts.frozen !== "56" || facts.matches !== "42" || facts.linked !== "0") {
    throw new Error(`Rivals fixture 未无损迁移：${JSON.stringify(facts)}`);
  }
  const claims = await client.query<{ entry_name: string; user_id: string }>(`
    SELECT e.name AS entry_name, c.user_id FROM competition_entry_active_claims c
    JOIN competition_entries e ON e.id = c.entry_id
    WHERE e.name IN ('Returned for changes', 'Current commitment', 'Invitation only') ORDER BY e.name
  `);
  if (claims.rows.length !== 1 || claims.rows[0]?.entry_name !== "Current commitment") {
    throw new Error("legacy claim reconciliation 复制了邀请或历史 application，或丢失当前 confirmed commitment。");
  }
  const major = await client.query<{ name: string; source: string; team_id: string | null; entry_id: string; legacy_team_id: string | null }>(`
    SELECT e.name, e.source::text, e.team_id, e.id AS entry_id, l.legacy_id AS legacy_team_id
    FROM competition_entries e LEFT JOIN competition_entry_legacy_identities l ON l.entry_id = e.id AND l.legacy_type = 'season_team'
    WHERE e.name IN ('Returned for changes', 'Current commitment', 'Application identity', 'Invitation only') ORDER BY e.name
  `);
  const rejected = major.rows.find((row) => row.name === "Returned for changes");
  const invitation = major.rows.find((row) => row.name === "Invitation only");
  const identity = major.rows.find((row) => row.name === "Application identity");
  if (!rejected || rejected.source !== "event_native" || rejected.team_id || !invitation || invitation.source !== "event_native" || invitation.team_id || !identity || identity.entry_id === identity.legacy_team_id) {
    throw new Error("Major application identity / historical-team reconciliation 不符合终态边界。");
  }
}

async function main(): Promise<void> {
  const admin = new Client({ connectionString: maintenance.toString(), ssl: false });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const target = new URL(databaseUrl!);
    target.pathname = `/${databaseName}`;
    const client = new Client({ connectionString: target.toString(), ssl: false });
    await client.connect();
    try {
      const migrations = readdirSync(join(process.cwd(), "drizzle/migrations")).filter((name) => /^00(?:0[0-9]|1[0-7])_.*\.sql$/.test(name)).sort();
      for (const migration of migrations.filter((name) => !name.startsWith("0017_"))) await runMigration(client, migration);
      const rivals = await insertRivalsFixture(client);
      await insertMajorReconciliationFixture(client);
      const terminalMigration = migrations.find((name) => name.startsWith("0017_"));
      if (!terminalMigration) throw new Error("找不到 0017 CompetitionEntry 迁移。");
      await runMigration(client, terminalMigration);
      await assertReplay(client, rivals);
      console.log("CompetitionEntry migration replay passed: Rivals 8/56/42 preserved; historical rejected, confirmed current commitment, invitation-only claim, and application/runtime identity reconciliation verified.");
    } finally {
      await client.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });
