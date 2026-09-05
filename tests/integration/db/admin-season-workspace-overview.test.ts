import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMajorDefaultCapabilities } from "../../../src/types/season";
import { loadSeasonWorkspaceOverview } from "../../../src/lib/admin/season-workspace/overview";
import { createLocalPool } from "./harness/database";

describe("admin season workspace overview PostgreSQL integration", () => {
  it("loads a Major overview through CompetitionEntry and EventRoster joins", async () => {
    const pool = createLocalPool({ max: 2 });
    const ids = {
      season: randomUUID(),
      entry: randomUUID(),
      revision: randomUUID(),
      entrant: randomUUID(),
      eventRoster: randomUUID(),
      member: randomUUID(),
      user: randomUUID(),
    };
    const seasonSlug = `admin-major-overview-${ids.season}`;
    const capabilities = createMajorDefaultCapabilities();
    const client = await pool.connect();
    let committed = false;

    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(
        `INSERT INTO seasons (
           id, slug, name, kind, competition_template, status, registration_mode,
           has_captain_voting, has_draft, stage_plan, registration_config,
           team_registration_config, affiliation_rules, min_team_size, max_team_size,
           starter_count, positions
         ) VALUES ($1, $2, 'Admin Major Overview', 'Major', 'major', 'playing', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
        [
          ids.season,
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
        `INSERT INTO users (id, email, display_name, steam_name)
         VALUES ($1, $2, 'Overview Player', 'Overview Player')`,
        [ids.user, `${ids.user}@local.test`],
      );
      await client.query(
        `INSERT INTO competition_entries (
           id, competition_id, source, name, representative_user_id,
           formation_order, current_roster_revision_id, approved_roster_revision_id,
           registration_status
         ) VALUES ($1, $2, 'event_native', 'Overview Entry', $3, 1, $4, $4, 'approved')`,
        [ids.entry, ids.season, ids.user, ids.revision],
      );
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (
           id, entry_id, revision_number, status, created_by, approved_at
         ) VALUES ($1, $2, 1, 'approved', 'admin-season-workspace-overview', now())`,
        [ids.revision, ids.entry],
      );
      await client.query(
        `INSERT INTO event_rosters (
           id, entry_id, source_roster_revision_id, status,
           confirmed_at, confirmed_by, frozen_at, frozen_by
         ) VALUES ($1, $2, $3, 'confirmed', now(), 'admin-season-workspace-overview', NULL, NULL)`,
        [ids.eventRoster, ids.entry, ids.revision],
      );
      await client.query(
        `INSERT INTO event_roster_members (id, event_roster_id, user_id, is_primary_starter)
         VALUES ($1, $2, $3, true)`,
        [ids.member, ids.eventRoster, ids.user],
      );
      await client.query(
        `UPDATE event_rosters
         SET status = 'frozen', frozen_at = now(), frozen_by = 'admin-season-workspace-overview'
         WHERE id = $1`,
        [ids.eventRoster],
      );
      await client.query(
        `INSERT INTO major_tournament_entrants (id, season_id, competition_entry_id)
         VALUES ($1, $2, $3)`,
        [ids.entrant, ids.season, ids.entry],
      );
      await client.query("COMMIT");
      committed = true;

      const overview = await loadSeasonWorkspaceOverview(seasonSlug);

      expect(overview).toMatchObject({
        season: {
          id: ids.season,
          slug: seasonSlug,
          competitionTemplate: "major",
          registrationMode: "team",
        },
        summary: {
          approvedEntries: 1,
          formedTeamCount: 1,
          entrantCount: 1,
          frozenEntrantCount: 1,
        },
      });
      expect(overview?.readiness).not.toBeNull();
    } finally {
      if (!committed) {
        await client.query("ROLLBACK").catch(() => undefined);
      } else {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM major_tournament_entrants WHERE id = $1", [ids.entrant]);
        await client.query("DELETE FROM event_roster_members WHERE id = $1", [ids.member]);
        await client.query("DELETE FROM event_rosters WHERE id = $1", [ids.eventRoster]);
        await client.query("DELETE FROM competition_entry_roster_revisions WHERE id = $1", [ids.revision]);
        await client.query("DELETE FROM competition_entries WHERE id = $1", [ids.entry]);
        await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
        await client.query("DELETE FROM users WHERE id = $1", [ids.user]);
        await client.query("COMMIT");
      }
      client.release();
      await pool.end();
    }
  });
});
