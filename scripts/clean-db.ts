import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db/client";
import { sql } from "drizzle-orm";

async function clean() {
  console.log("Truncating all tables...");
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      match_player_stats,
      match_mvp_votes,
      audit_logs,
      swiss_standings,
      draft_picks,
      draft_state,
      match_maps,
      matches,
      team_members,
      teams,
      captain_votes,
      season_registrations,
      admin_invites,
      admin_users,
      users,
      seasons
    CASCADE
  `));
  console.log("All tables truncated. Ready for fresh seed.");
}

clean()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
