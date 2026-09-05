import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";

const requireSeasonAdminMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
}));

import { loadAdminMatchOverview } from "@/lib/admin/matches/overview";
import { loadAdminMatchWorkbench } from "@/lib/admin/matches/workbench";

describe("admin match read models PostgreSQL integration", () => {
  it("keeps match detail season-scoped and preserves lightweight overview facts", async () => {
    const pool = createLocalPool({ max: 2 });
    const ids = {
      admin: randomUUID(),
      playerA: randomUUID(),
      playerB: randomUUID(),
      seasonA: randomUUID(),
      seasonB: randomUUID(),
      entryA: randomUUID(),
      entryB: randomUUID(),
      entryC: randomUUID(),
      entryD: randomUUID(),
      revisionA: randomUUID(),
      revisionB: randomUUID(),
      revisionC: randomUUID(),
      revisionD: randomUUID(),
      eventRosterA: randomUUID(),
      eventRosterB: randomUUID(),
      memberA: randomUUID(),
      memberB: randomUUID(),
      matchA: randomUUID(),
      matchB: randomUUID(),
      rosterA: randomUUID(),
      rosterB: randomUUID(),
      mapA: randomUUID(),
    };
    const seasonASlug = `admin-read-model-a-${ids.seasonA}`;
    const seasonBSlug = `admin-read-model-b-${ids.seasonB}`;
    const stagePlan = JSON.stringify([{
      key: "round_robin",
      name: "循环赛",
      type: "round_robin",
      teamCount: 2,
      advanceTiers: [],
    }]);
    const registrationConfig = JSON.stringify({ mapPool: ["de_inferno", "de_mirage", "de_nuke"] });

    try {
      await pool.query(
        `INSERT INTO users (id, email, display_name, steam_name, live_stream_url)
         VALUES ($1, $2, '赛事管理员', 'Admin', 'https://live.example/admin'),
                ($3, $4, 'Alpha 首发', 'Alpha Player', NULL),
                ($5, $6, 'Beta 首发', 'Beta Player', NULL)`,
        [
          ids.admin,
          `${ids.admin}@local.test`,
          ids.playerA,
          `${ids.playerA}@local.test`,
          ids.playerB,
          `${ids.playerB}@local.test`,
        ],
      );
      await pool.query(
        `INSERT INTO seasons (
           id, slug, name, kind, competition_template, status, registration_mode,
           has_captain_voting, has_draft, stage_plan, registration_config,
           team_registration_config, min_team_size, max_team_size, starter_count
         ) VALUES
           ($1, $2, 'Read model A', 'Rivals', 'rivals', 'playing', 'team', false, false, $3::json, $4::json, '{}'::json, 1, 1, 1),
           ($5, $6, 'Read model B', 'Rivals', 'rivals', 'playing', 'team', false, false, $3::json, $4::json, '{}'::json, 1, 1, 1)`,
        [ids.seasonA, seasonASlug, stagePlan, registrationConfig, ids.seasonB, seasonBSlug],
      );
      await pool.query(
        `INSERT INTO season_admin_grants (user_id, season_id)
         VALUES ($1, $2)`,
        [ids.admin, ids.seasonA],
      );

      const entryClient = await pool.connect();
      try {
        await entryClient.query("BEGIN");
        await entryClient.query("SET CONSTRAINTS ALL DEFERRED");
        await entryClient.query(
          `INSERT INTO competition_entries (
             id, competition_id, source, name, representative_user_id,
             formation_order, current_roster_revision_id, approved_roster_revision_id, registration_status
           ) VALUES
             ($1, $2, 'event_native', 'Alpha', $3, 1, $4, $4, 'approved'),
             ($5, $2, 'event_native', 'Beta', $3, 2, $6, $6, 'approved'),
             ($7, $8, 'event_native', 'Other C', $3, 1, $9, $9, 'approved'),
             ($10, $8, 'event_native', 'Other D', $3, 2, $11, $11, 'approved')`,
          [
            ids.entryA,
            ids.seasonA,
            ids.admin,
            ids.revisionA,
            ids.entryB,
            ids.revisionB,
            ids.entryC,
            ids.seasonB,
            ids.revisionC,
            ids.entryD,
            ids.revisionD,
          ],
        );
        await entryClient.query(
          `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
           VALUES ($1, NULL, $2, 'admin-read-model-test'), ($3, NULL, $2, 'admin-read-model-test'),
                  ($4, NULL, $2, 'admin-read-model-test'), ($5, NULL, $2, 'admin-read-model-test')`,
          [ids.entryA, ids.admin, ids.entryB, ids.entryC, ids.entryD],
        );
        await entryClient.query(
          `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
           VALUES ($1, $2, 1, 'approved', 'admin-read-model-test', now()),
                  ($3, $4, 1, 'approved', 'admin-read-model-test', now()),
                  ($5, $6, 1, 'approved', 'admin-read-model-test', now()),
                  ($7, $8, 1, 'approved', 'admin-read-model-test', now())`,
          [ids.revisionA, ids.entryA, ids.revisionB, ids.entryB, ids.revisionC, ids.entryC, ids.revisionD, ids.entryD],
        );
        await entryClient.query("COMMIT");
      } catch (error) {
        await entryClient.query("ROLLBACK");
        throw error;
      } finally {
        entryClient.release();
      }

      await pool.query(
        `INSERT INTO event_rosters (
           id, entry_id, source_roster_revision_id, status,
           confirmed_at, confirmed_by, frozen_at, frozen_by
         ) VALUES
           ($1, $2, $3, 'preparing', NULL, NULL, NULL, NULL),
           ($4, $5, $6, 'preparing', NULL, NULL, NULL, NULL)`,
        [ids.eventRosterA, ids.entryA, ids.revisionA, ids.eventRosterB, ids.entryB, ids.revisionB],
      );
      await pool.query(
        `INSERT INTO event_roster_members (id, event_roster_id, user_id, is_primary_starter)
         VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
        [ids.memberA, ids.eventRosterA, ids.playerA, ids.memberB, ids.eventRosterB, ids.playerB],
      );
      await pool.query(
        `UPDATE event_rosters
         SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'admin-read-model-test'
         WHERE id IN ($1, $2)`,
        [ids.eventRosterA, ids.eventRosterB],
      );
      await pool.query(
        `UPDATE event_rosters
         SET status = 'frozen', frozen_at = now(), frozen_by = 'admin-read-model-test'
         WHERE id IN ($1, $2)`,
        [ids.eventRosterA, ids.eventRosterB],
      );
      await pool.query(
        `INSERT INTO matches (
           id, season_id, entry_a_id, entry_b_id, stage, format, status,
           score_a, score_b, completed_at, video_url
         ) VALUES ($1, $2, $3, $4, 'round_robin', 'bo1', 'finished', 1, 0, now(), 'https://video.example/read-model')`,
        [ids.matchA, ids.seasonA, ids.entryA, ids.entryB],
      );
      await pool.query(
        `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, status)
         VALUES ($1, $2, $3, $4, 'round_robin', 'bo1', 'scheduled')`,
        [ids.matchB, ids.seasonB, ids.entryC, ids.entryD],
      );
      await pool.query(
        `INSERT INTO match_rosters (
           id, match_id, entry_id, source, status, locked_at, confirmed_at, confirmed_by
         ) VALUES
           ($1, $2, $3, 'admin_select', 'confirmed', now(), now(), 'admin-read-model-test'),
           ($4, $2, $5, 'admin_select', 'confirmed', now(), now(), 'admin-read-model-test')`,
        [ids.rosterA, ids.matchA, ids.entryA, ids.rosterB, ids.entryB],
      );
      await pool.query(
        `INSERT INTO match_roster_players (roster_id, event_roster_member_id, is_starter)
         VALUES ($1, $2, true), ($3, $4, true)`,
        [ids.rosterA, ids.memberA, ids.rosterB, ids.memberB],
      );
      await pool.query(
        `INSERT INTO match_maps (id, match_id, map_order, map_name, score_a, score_b, completed_at)
         VALUES ($1, $2, 1, 'de_inferno', 13, 8, now())`,
        [ids.mapA, ids.matchA],
      );
      await pool.query(
        `INSERT INTO match_commentators (match_id, user_id, added_by_user_id)
         VALUES ($1, $2, $2)`,
        [ids.matchA, ids.admin],
      );
      await pool.query(
        `INSERT INTO post_match_reports (match_id, submitted_by_user_id)
         VALUES ($1, $2)`,
        [ids.matchA, ids.admin],
      );

      requireSeasonAdminMock.mockResolvedValue({ userId: ids.admin });

      const workbench = await loadAdminMatchWorkbench({ seasonSlug: seasonASlug, matchId: ids.matchA });
      expect(workbench).toMatchObject({
        season: { id: ids.seasonA, slug: seasonASlug },
        match: { id: ids.matchA, seasonId: ids.seasonA, videoUrl: "https://video.example/read-model" },
        teamAName: "Alpha",
        teamBName: "Beta",
        teamARoster: { rosterId: ids.rosterA, starters: [ids.memberA], status: "confirmed" },
        completedMaps: [{ mapOrder: 1, mapName: "de_inferno", scoreA: 13, scoreB: 8 }],
        postMatch: {
          submittedByUserId: ids.admin,
          videoUrl: "https://video.example/read-model",
          commentators: [expect.objectContaining({ userId: ids.admin, name: "赛事管理员" })],
        },
      });
      expect(workbench?.teamAMembers).toEqual([
        expect.objectContaining({ id: ids.memberA, entryId: ids.entryA, displayName: "Alpha 首发" }),
      ]);

      await expect(
        loadAdminMatchWorkbench({ seasonSlug: seasonASlug, matchId: ids.matchB }),
      ).resolves.toBeNull();

      const overview = await loadAdminMatchOverview({ seasonSlug: seasonASlug });
      expect(overview).not.toBeNull();
      expect(overview?.matches).toHaveLength(1);
      expect(overview?.matches[0]).toMatchObject({ id: ids.matchA, status: "finished", scoreA: 1, scoreB: 0 });
      expect(overview?.matches[0]).not.toHaveProperty("videoUrl");
      expect(overview).not.toHaveProperty("mapPool");
      expect(overview?.swissRuntime).toBeNull();
      expect(overview?.playoffRuntime).toBeNull();
      expect(overview?.commentaryEffectiveness).toEqual([
        expect.objectContaining({
          admin: expect.objectContaining({ userId: ids.admin, name: "赛事管理员" }),
          matches: [expect.objectContaining({ id: ids.matchA })],
        }),
      ]);
    } finally {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query("BEGIN");
        await cleanupClient.query("SET LOCAL session_replication_role = replica");
        await cleanupClient.query("DELETE FROM post_match_reports WHERE match_id IN ($1, $2)", [ids.matchA, ids.matchB]);
        await cleanupClient.query("DELETE FROM match_commentators WHERE match_id IN ($1, $2)", [ids.matchA, ids.matchB]);
        await cleanupClient.query("DELETE FROM match_roster_players WHERE roster_id IN ($1, $2)", [ids.rosterA, ids.rosterB]);
        await cleanupClient.query("DELETE FROM match_rosters WHERE id IN ($1, $2)", [ids.rosterA, ids.rosterB]);
        await cleanupClient.query("DELETE FROM match_maps WHERE id = $1", [ids.mapA]);
        await cleanupClient.query("DELETE FROM matches WHERE id IN ($1, $2)", [ids.matchA, ids.matchB]);
        await cleanupClient.query("DELETE FROM event_roster_members WHERE id IN ($1, $2)", [ids.memberA, ids.memberB]);
        await cleanupClient.query("DELETE FROM event_rosters WHERE id IN ($1, $2)", [ids.eventRosterA, ids.eventRosterB]);
        await cleanupClient.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1, $2, $3, $4)", [ids.entryA, ids.entryB, ids.entryC, ids.entryD]);
        await cleanupClient.query("DELETE FROM competition_entry_roster_revisions WHERE id IN ($1, $2, $3, $4)", [ids.revisionA, ids.revisionB, ids.revisionC, ids.revisionD]);
        await cleanupClient.query("DELETE FROM competition_entries WHERE id IN ($1, $2, $3, $4)", [ids.entryA, ids.entryB, ids.entryC, ids.entryD]);
        await cleanupClient.query("DELETE FROM season_admin_grants WHERE season_id IN ($1, $2)", [ids.seasonA, ids.seasonB]);
        await cleanupClient.query("DELETE FROM seasons WHERE id IN ($1, $2)", [ids.seasonA, ids.seasonB]);
        await cleanupClient.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [ids.admin, ids.playerA, ids.playerB]);
        await cleanupClient.query("COMMIT");
      } catch {
        await cleanupClient.query("ROLLBACK").catch(() => undefined);
      } finally {
        cleanupClient.release();
        await pool.end();
      }
    }
  });
});
