import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { acceptTeamInvitationInTx } from "../../../src/lib/teams/invitations";
import { closeTeamRecruitmentInTx, expressRecruitmentInterestInTx, upsertPlayerLftInTx, upsertTeamRecruitmentInTx } from "../../../src/lib/recruitment/commands";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

describe("recruitment PostgreSQL invariants", () => {
  it("keeps intent ownership separate from membership and closes LFT only through the canonical invite path", async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
    const database = drizzle(pool, { schema });
    const ids = { captain: randomUUID(), interested: randomUUID(), invitee: randomUUID(), team: randomUUID(), invitation: randomUUID() };
    try {
      await pool.query("BEGIN");
      await pool.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Captain'), ($3, $4, 'Interested'), ($5, $6, 'Invitee')", [
        ids.captain, `recruitment-captain-${ids.captain}@local.test`, ids.interested, `recruitment-interested-${ids.interested}@local.test`, ids.invitee, `recruitment-invitee-${ids.invitee}@local.test`,
      ]);
      await pool.query("INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Recruitment Team', $3, $3)", [ids.team, `recruitment-${ids.team.slice(0, 8)}`, ids.captain]);
      await pool.query("INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'active', $2)", [ids.team, ids.captain]);
      await pool.query("INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [ids.team, ids.captain]);
      await pool.query("INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, 'Recruitment Team', 'local-test')", [ids.team]);
      await pool.query("COMMIT");

      const teamIntent = await database.transaction((tx) => upsertTeamRecruitmentInTx(tx, { teamId: ids.team, userId: ids.captain, actorId: ids.captain, positions: ["awper"], targetSeasonId: null, note: "寻找稳定主狙" }));
      await database.transaction((tx) => expressRecruitmentInterestInTx(tx, { recruitmentIntentId: teamIntent.id, userId: ids.interested, actorId: ids.interested }));
      const interestCount = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM recruitment_interests WHERE recruitment_intent_id = $1", [teamIntent.id]);
      expect(interestCount.rows[0]?.count === "1", "表达加入意向只能写 recruitment_interests，不能直接创建 membership。").toBe(true);
      const membershipCount = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM team_memberships WHERE team_id = $1 AND user_id = $2 AND ended_at IS NULL", [ids.team, ids.interested]);
      expect(membershipCount.rows[0]?.count === "0", "interest 不是成员关系。").toBe(true);

      await database.transaction((tx) => closeTeamRecruitmentInTx(tx, { teamId: ids.team, userId: ids.captain, actorId: ids.captain }));
      const afterClose = await pool.query<{ status: string; interests: string }>(
        "SELECT (SELECT status::text FROM recruitment_intents WHERE id = $1) AS status, (SELECT count(*)::text FROM recruitment_interests WHERE recruitment_intent_id = $1) AS interests",
        [teamIntent.id],
      );
      expect(afterClose.rows[0]?.status === "closed" && afterClose.rows[0]?.interests === "0", "关闭 Team 招募必须关闭 intent 并清除旧 interest。").toBe(true);

      await database.transaction((tx) => upsertPlayerLftInTx(tx, { userId: ids.invitee, actorId: ids.invitee, positions: ["closer"], targetSeasonId: null, note: "找长期队" }));
      await pool.query("INSERT INTO team_invitations (id, team_id, kind, invited_user_id, invited_by_user_id, status, expires_at) VALUES ($1, $2, 'direct', $3, $4, 'pending', now() + interval '7 days')", [ids.invitation, ids.team, ids.invitee, ids.captain]);
      const accepted = await database.transaction((tx) => acceptTeamInvitationInTx(tx, { userId: ids.invitee, actorId: ids.invitee, invitationId: ids.invitation }));
      expect(accepted.kind === "accepted", "有效邀请必须通过既有邀请 owner 成员化。").toBe(true);
      const acceptedState = await pool.query<{ lft: string; memberships: string }>(
        "SELECT (SELECT status::text FROM recruitment_intents WHERE user_id = $1) AS lft, (SELECT count(*)::text FROM team_memberships WHERE team_id = $2 AND user_id = $1 AND ended_at IS NULL) AS memberships",
        [ids.invitee, ids.team],
      );
      expect(acceptedState.rows[0]?.lft === "closed" && acceptedState.rows[0]?.memberships === "1", "接受 TeamInvitation 后才关闭 LFT 并形成正式 membership。").toBe(true);

      await expect(pool.query("INSERT INTO recruitment_intents (kind, team_id, expires_at) VALUES ('player_lft', $1, now() + interval '1 day')", [ids.team]))
        .rejects.toMatchObject({ code: "23514" });
    } finally {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM recruitment_interests WHERE user_id IN ($1, $2, $3)", [ids.captain, ids.interested, ids.invitee]);
        await client.query("DELETE FROM recruitment_intents WHERE team_id = $1 OR user_id IN ($2, $3, $4)", [ids.team, ids.captain, ids.interested, ids.invitee]);
        await client.query("DELETE FROM team_invitations WHERE team_id = $1", [ids.team]);
        await client.query("DELETE FROM team_captain_changes WHERE team_id = $1", [ids.team]);
        await client.query("DELETE FROM team_name_changes WHERE team_id = $1", [ids.team]);
        await client.query("DELETE FROM team_memberships WHERE team_id = $1", [ids.team]);
        await client.query("DELETE FROM teams WHERE id = $1", [ids.team]);
        await client.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [ids.captain, ids.interested, ids.invitee]);
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
