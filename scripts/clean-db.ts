import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "pg";

const TABLES = [
  "match_player_stats",
  "match_mvp_votes",
  "audit_logs",
  "swiss_standings",
  "match_roster_players",
  "match_rosters",
  "match_time_proposals",
  "registration_drafts",
  "draft_picks",
  "draft_state",
  "match_maps",
  "matches",
  "team_members",
  "teams",
  "captain_votes",
  "season_registrations",
  "admin_invites",
  "admin_users",
  "users",
  "seasons",
];

async function clean() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: shouldUseSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  console.log("Truncating all tables...");
  try {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = $1 and tablename = any($2::text[])",
      ["public", TABLES],
    );
    const existingTables = TABLES.filter((table) =>
      rows.some((row) => row.tablename === table),
    );

    if (existingTables.length > 0) {
      const tableSql = existingTables.map((table) => `public.${quoteIdent(table)}`).join(", ");
      await pool.query(`TRUNCATE TABLE ${tableSql} CASCADE`);
    }

    console.log("All tables truncated. Ready for fresh seed.");
  } finally {
    await pool.end();
  }
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function shouldUseSsl(databaseUrl?: string): boolean {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    if (url.searchParams.get("sslmode") === "disable") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return true;
  }
}

clean()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
