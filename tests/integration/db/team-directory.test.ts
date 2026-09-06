import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { getTeamDirectory } from "../../../src/lib/teams/directory";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

describe("team directory PostgreSQL read model", () => {
  it("searches the public captain name, applies lifecycle/recruitment filters, and orders by grouped membership counts", async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
    const ids = {
      captainAlpha: randomUUID(),
      captainBeta: randomUUID(),
      captainHistory: randomUUID(),
      captainTarget: randomUUID(),
      recruitingMember: randomUUID(),
      largerMemberOne: randomUUID(),
      largerMemberTwo: randomUUID(),
      largerMemberThree: randomUUID(),
      largerMemberFour: randomUUID(),
      activeRecruiting: randomUUID(),
      activeLarger: randomUUID(),
      history: randomUUID(),
      targetUnavailable: randomUUID(),
      draftSeason: randomUUID(),
    };
    const userIds = [
      ids.captainAlpha,
      ids.captainBeta,
      ids.captainHistory,
      ids.captainTarget,
      ids.recruitingMember,
      ids.largerMemberOne,
      ids.largerMemberTwo,
      ids.largerMemberThree,
      ids.largerMemberFour,
    ];
    const teamIds = [ids.activeRecruiting, ids.activeLarger, ids.history, ids.targetUnavailable];

    try {
      const fixture = await pool.connect();
      try {
        await fixture.query("BEGIN");
        await fixture.query(
        `INSERT INTO users (id, email, display_name)
         VALUES ($1, $2, 'Captain Alpha'),
                ($3, $4, 'Captain Beta'),
                ($5, $6, 'Captain History'),
                ($7, $8, 'Captain Target'),
                ($9, $10, 'Recruiting Member'),
                ($11, $12, 'Larger Member One'),
                ($13, $14, 'Larger Member Two'),
                ($15, $16, 'Larger Member Three'),
                ($17, $18, 'Larger Member Four')`,
        [
          ids.captainAlpha, `team-directory-alpha-${ids.captainAlpha}@local.test`,
          ids.captainBeta, `team-directory-beta-${ids.captainBeta}@local.test`,
          ids.captainHistory, `team-directory-history-${ids.captainHistory}@local.test`,
          ids.captainTarget, `team-directory-target-${ids.captainTarget}@local.test`,
          ids.recruitingMember, `team-directory-recruiting-member-${ids.recruitingMember}@local.test`,
          ids.largerMemberOne, `team-directory-larger-one-${ids.largerMemberOne}@local.test`,
          ids.largerMemberTwo, `team-directory-larger-two-${ids.largerMemberTwo}@local.test`,
          ids.largerMemberThree, `team-directory-larger-three-${ids.largerMemberThree}@local.test`,
          ids.largerMemberFour, `team-directory-larger-four-${ids.largerMemberFour}@local.test`,
          ],
        );
        await fixture.query(
        `INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id, status, disbanded_at)
         VALUES ($1, $2, 'Zulu Recruiting', $3, $3, 'active', NULL),
                ($4, $5, 'Alpha Larger', $6, $6, 'active', NULL),
                ($7, $8, 'History Team', $9, $9, 'disbanded', now()),
                ($10, $11, 'Target Locked', $12, $12, 'active', NULL)`,
        [
          ids.activeRecruiting, `team-directory-recruiting-${ids.activeRecruiting.slice(0, 8)}`, ids.captainAlpha,
          ids.activeLarger, `team-directory-larger-${ids.activeLarger.slice(0, 8)}`, ids.captainBeta,
          ids.history, `team-directory-history-${ids.history.slice(0, 8)}`, ids.captainHistory,
          ids.targetUnavailable, `team-directory-target-${ids.targetUnavailable.slice(0, 8)}`, ids.captainTarget,
          ],
        );
        await fixture.query(
         `INSERT INTO team_memberships (team_id, user_id, status)
         VALUES ($1, $2, 'active'), ($1, $3, 'active'),
                ($4, $5, 'active'), ($4, $6, 'active'), ($4, $7, 'active'), ($4, $8, 'active'), ($4, $9, 'active'),
                ($10, $11, 'active')`,
        [
          ids.activeRecruiting, ids.captainAlpha, ids.recruitingMember,
          ids.activeLarger, ids.captainBeta, ids.largerMemberOne, ids.largerMemberTwo, ids.largerMemberThree, ids.largerMemberFour,
          ids.targetUnavailable, ids.captainTarget,
          ],
        );
        await fixture.query(
        `INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id)
         VALUES ($1, NULL, $2, 'local-test'),
                ($3, NULL, $4, 'local-test'),
                ($5, NULL, $6, 'local-test'),
                ($7, NULL, $8, 'local-test')`,
        [
          ids.activeRecruiting, ids.captainAlpha,
          ids.activeLarger, ids.captainBeta,
          ids.history, ids.captainHistory,
          ids.targetUnavailable, ids.captainTarget,
        ],
        );
        await fixture.query(
        `INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id)
         VALUES ($1, NULL, 'Zulu Recruiting', 'local-test'),
                ($2, NULL, 'Alpha Larger', 'local-test'),
                ($3, NULL, 'History Team', 'local-test'),
                ($4, NULL, 'Target Locked', 'local-test')`,
        [ids.activeRecruiting, ids.activeLarger, ids.history, ids.targetUnavailable],
        );
        await fixture.query(
        "INSERT INTO seasons (id, slug, name, kind, status, registration_closes_at) VALUES ($1, $2, 'Draft target', 'custom', 'draft', now() + interval '7 days')",
        [ids.draftSeason, `team-directory-draft-${ids.draftSeason.slice(0, 8)}`],
        );
        await fixture.query(
        `INSERT INTO recruitment_intents (kind, team_id, target_season_id, status, expires_at)
         VALUES ('team_recruiting', $1, NULL, 'open', now() + interval '1 day'),
                ('team_recruiting', $2, $3, 'open', now() + interval '1 day')`,
        [ids.activeRecruiting, ids.targetUnavailable, ids.draftSeason],
        );
        await fixture.query("COMMIT");
      } catch (error) {
        await fixture.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        fixture.release();
      }

      const defaultDirectory = await getTeamDirectory({ q: "", status: "active", recruiting: false, sort: "default" });
      expect(defaultDirectory.rows.map((team) => team.name)).toEqual(["Zulu Recruiting", "Alpha Larger", "Target Locked"]);
      expect(defaultDirectory.rows.map((team) => team.memberCount)).toEqual([2, 5, 1]);
      expect(defaultDirectory.rows[0]?.hasOpenRecruitment).toBe(true);
      expect(defaultDirectory.rows[2]?.hasOpenRecruitment).toBe(false);

      const captainSearch = await getTeamDirectory({ q: "Captain Alpha", status: "active", recruiting: false, sort: "default" });
      expect(captainSearch.rows.map((team) => team.name)).toEqual(["Zulu Recruiting"]);

      const recruitingOnly = await getTeamDirectory({ q: "", status: "active", recruiting: true, sort: "default" });
      expect(recruitingOnly.rows.map((team) => team.name)).toEqual(["Zulu Recruiting"]);

      const historyDirectory = await getTeamDirectory({ q: "", status: "history", recruiting: false, sort: "name" });
      expect(historyDirectory.rows.map((team) => team.name)).toEqual(["History Team"]);
      expect(historyDirectory.rows[0]?.status).toBe("disbanded");

      const ascending = await getTeamDirectory({ q: "", status: "active", recruiting: false, sort: "members_asc" });
      expect(ascending.rows.map((team) => team.memberCount)).toEqual([1, 2, 5]);
      const descending = await getTeamDirectory({ q: "", status: "active", recruiting: false, sort: "members_desc" });
      expect(descending.rows.map((team) => team.memberCount)).toEqual([5, 2, 1]);
    } finally {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM recruitment_intents WHERE team_id = ANY($1::uuid[])", [teamIds]);
        await client.query("DELETE FROM team_captain_changes WHERE team_id = ANY($1::uuid[])", [teamIds]);
        await client.query("DELETE FROM team_name_changes WHERE team_id = ANY($1::uuid[])", [teamIds]);
        await client.query("DELETE FROM team_memberships WHERE team_id = ANY($1::uuid[])", [teamIds]);
        await client.query("DELETE FROM teams WHERE id = ANY($1::uuid[])", [teamIds]);
        await client.query("DELETE FROM seasons WHERE id = $1", [ids.draftSeason]);
        await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await pool.end();
    }
  });
});
