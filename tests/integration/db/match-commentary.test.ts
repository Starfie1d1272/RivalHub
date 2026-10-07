import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { localDatabaseUrl } from "./harness/database";

async function createFixture() {
  const pool = new Pool({ connectionString: localDatabaseUrl(), ssl: false });
  const schema = await import("@/db/schema");
  const database = drizzle(pool, { schema });
  const seasonId = randomUUID();
  const otherSeasonId = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  const adminC = randomUUID();
  const outsider = randomUUID();
  const otherAdmin = randomUUID();
  const superAdmin = randomUUID();
  const userIds = [adminA, adminB, adminC, outsider, otherAdmin, superAdmin];
  const entryIds: string[] = [];
  const entriesBySeason = new Map<string, [string, string]>();
  for (const [index, userId] of userIds.entries()) {
    await pool.query("INSERT INTO users (id,email,display_name,role) VALUES ($1,$2,$3,$4)", [userId, `${userId}@local.test`, `解说${index + 1}`, userId === superAdmin ? "super_admin" : "user"]);
  }
  for (const eventId of [seasonId, otherSeasonId]) {
    await pool.query("INSERT INTO seasons (id,slug,name,kind,status,registration_mode,has_captain_voting,has_draft) VALUES ($1,$2,'Commentary','Major','playing','team',false,false)", [eventId, `commentary-${eventId}`]);
    const entryA = randomUUID();
    const entryB = randomUUID();
    entriesBySeason.set(eventId, [entryA, entryB]);
    entryIds.push(entryA, entryB);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[entryA, "Alpha"], [entryB, "Beta"]]) {
        const revision = randomUUID();
        await client.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,approved_roster_revision_id,registration_status) VALUES ($1,$2,'event_native',$3,$4,$5,$5,'approved')", [id, eventId, name, adminA, revision]);
        await client.query("INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test')", [id, adminA]);
        await client.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES ($1,$2,1,'approved','local-test',now())", [revision, id]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.query("INSERT INTO season_admin_grants (user_id,season_id) VALUES ($1,$5),($2,$5),($3,$5),($4,$6)", [adminA, adminB, adminC, otherAdmin, seasonId, otherSeasonId]);

  return {
    pool, database, seasonId, otherSeasonId, adminA, adminB, adminC, outsider, otherAdmin, superAdmin,
    async createMatch(options: { season?: string; status?: "scheduled" | "in_progress" | "finished" | "cancelled"; scheduledAt?: string | null } = {}) {
      const id = randomUUID();
      const eventId = options.season ?? seasonId;
      const [entryA, entryB] = entriesBySeason.get(eventId)!;
      await pool.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage,format,status,scheduled_at) VALUES ($1,$2,$3,$4,'final','bo1',$5,$6)", [id, eventId, entryA, entryB, options.status ?? "scheduled", options.scheduledAt ?? null]);
      return id;
    },
    async close() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM audit_logs WHERE season_id = ANY($1::uuid[])", [[seasonId, otherSeasonId]]);
        await client.query("DELETE FROM match_commentators WHERE match_id IN (SELECT id FROM matches WHERE season_id = ANY($1::uuid[]))", [[seasonId, otherSeasonId]]);
        await client.query("DELETE FROM matches WHERE season_id = ANY($1::uuid[])", [[seasonId, otherSeasonId]]);
        await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[])", [entryIds]);
        await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [entryIds]);
        await client.query("DELETE FROM competition_entries WHERE id = ANY($1::uuid[])", [entryIds]);
        await client.query("DELETE FROM season_admin_grants WHERE season_id = ANY($1::uuid[])", [[seasonId, otherSeasonId]]);
        await client.query("DELETE FROM seasons WHERE id = ANY($1::uuid[])", [[seasonId, otherSeasonId]]);
        await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
    },
  };
}

describe("match commentary PostgreSQL contract", () => {
  it("requires the actual claimant's grant for the match season and rejects terminal matches", async () => {
    const fixture = await createFixture();
    const { claimMatchCommentaryInTx, addMatchCommentatorInTx } = await import("@/lib/postmatch/service");
    const { database, adminA, adminB, outsider, otherAdmin, superAdmin } = fixture;
    try {
      const matchId = await fixture.createMatch();
      for (const userId of [outsider, otherAdmin, superAdmin]) {
        await expect(database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId, userId }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const foreignMatch = await fixture.createMatch({ season: fixture.otherSeasonId });
      await expect(database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: foreignMatch, userId: adminA }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId, userId: adminA }))).resolves.toMatchObject({ added: true });
      // Adding a second actual commentator through the existing admin command remains valid.
      await expect(database.transaction((tx) => addMatchCommentatorInTx(tx, { matchId, userId: adminB, actorId: adminA }))).resolves.toMatchObject({ added: true });
      for (const status of ["finished", "cancelled"] as const) {
        const terminalMatch = await fixture.createMatch({ status });
        await expect(database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: terminalMatch, userId: adminA }))).rejects.toMatchObject({ code: "MATCH_INVALID_TRANSITION" });
      }
      const lateRecord = await fixture.createMatch({ status: "finished" });
      await expect(database.transaction((tx) => addMatchCommentatorInTx(tx, { matchId: lateRecord, userId: adminA, actorId: adminB }))).resolves.toMatchObject({ added: true });
      const audit = await fixture.pool.query("SELECT actor_id, meta->>'commentatorUserId' AS commentator FROM audit_logs WHERE target_id=$1 AND action='postmatch.commentator.add' ORDER BY created_at", [matchId]);
      expect(audit.rows).toEqual([{ actor_id: adminA, commentator: adminA }, { actor_id: adminA, commentator: adminB }]);
    } finally {
      await fixture.close();
    }
  });

  it("serializes competing claims, keeps the two-person limit, and repeats a full-roster claim without a new audit", async () => {
    const fixture = await createFixture();
    const { claimMatchCommentaryInTx } = await import("@/lib/postmatch/service");
    try {
      const matchId = await fixture.createMatch();
      const claim = (userId: string) => fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId, userId }));
      const outcomes = await Promise.allSettled([fixture.adminA, fixture.adminB, fixture.adminC].map(claim));
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
      expect(outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason.code)).toEqual(["VALIDATION_FAILED"]);
      const roster = await fixture.pool.query<{ user_id: string }>("SELECT user_id FROM match_commentators WHERE match_id=$1", [matchId]);
      expect(roster.rows).toHaveLength(2);
      await expect(claim(roster.rows[0]!.user_id)).resolves.toEqual({ seasonId: fixture.seasonId, added: false });
      const audit = await fixture.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE target_id=$1 AND action='postmatch.commentator.add'", [matchId]);
      expect(audit.rows[0]?.count).toBe(2);

      const duplicateMatch = await fixture.createMatch();
      const repeats = await Promise.all([0, 1].map(() => fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: duplicateMatch, userId: fixture.adminA }))));
      expect(repeats.map((result) => result.added).sort()).toEqual([false, true]);
    } finally {
      await fixture.close();
    }
  });

  it("rechecks the latest match status after acquiring its row lock", async () => {
    const fixture = await createFixture();
    const { claimMatchCommentaryInTx } = await import("@/lib/postmatch/service");
    const client = await fixture.pool.connect();
    try {
      const matchId = await fixture.createMatch();
      await client.query("BEGIN");
      await client.query("UPDATE matches SET status='finished',score_a=1,score_b=0,completed_at=now() WHERE id=$1", [matchId]);
      const claim = fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId, userId: fixture.adminA }));
      const assertion = expect(claim).rejects.toMatchObject({ code: "MATCH_INVALID_TRANSITION" });
      await client.query("COMMIT");
      await assertion;
      const roster = await fixture.pool.query("SELECT user_id FROM match_commentators WHERE match_id=$1", [matchId]);
      expect(roster.rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await fixture.close();
    }
  });

  it("projects only this season's actual assignments, sorted next match, and all matches the viewer can claim", async () => {
    const fixture = await createFixture();
    const { claimMatchCommentaryInTx, addMatchCommentatorInTx } = await import("@/lib/postmatch/service");
    const { readAdminMatchCommentary } = await import("@/lib/admin/matches/commentary");
    try {
      const current = await fixture.createMatch({ status: "in_progress", scheduledAt: "2026-10-01T10:00:00Z" });
      const later = await fixture.createMatch({ scheduledAt: "2026-10-01T13:00:00Z" });
      const next = await fixture.createMatch({ scheduledAt: "2026-10-01T12:30:00Z" });
      const unscheduled = await fixture.createMatch();
      const finished = await fixture.createMatch({ status: "finished" });
      const cancelled = await fixture.createMatch({ status: "cancelled" });
      const foreign = await fixture.createMatch({ season: fixture.otherSeasonId, scheduledAt: "2026-10-01T11:00:00Z" });
      const others = await fixture.createMatch({ scheduledAt: "2026-10-01T11:30:00Z" });
      const full = await fixture.createMatch({ scheduledAt: "2026-10-01T11:45:00Z" });
      for (const matchId of [current, next, later, unscheduled]) await fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId, userId: fixture.adminA }));
      await fixture.database.transaction((tx) => addMatchCommentatorInTx(tx, { matchId: finished, userId: fixture.adminA, actorId: fixture.adminA }));
      await fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: others, userId: fixture.adminB }));
      for (const userId of [fixture.adminB, fixture.adminC]) await fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: full, userId }));
      await fixture.database.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: foreign, userId: fixture.otherAdmin }));
      const unclaimed: string[] = [];
      for (let index = 0; index < 6; index++) unclaimed.push(await fixture.createMatch({ scheduledAt: `2026-10-02T${String(index + 10).padStart(2, "0")}:00:00Z` }));
      const data = await readAdminMatchCommentary(fixture.database, { seasonId: fixture.seasonId, currentUserId: fixture.adminA });
      expect(data.currentMatches.map((match) => match.id)).toEqual([current]);
      expect(data.nextMatch).toEqual({ id: next, teamAName: "Alpha", teamBName: "Beta", scheduledAt: new Date("2026-10-01T12:30:00Z"), status: "scheduled" });
      expect(data.claimableMatches.map((match) => match.id)).toEqual([others, ...unclaimed]);
      expect(data.claimableCount).toBe(7);
      expect(data.byMatchId[full]?.canClaim).toBe(false);
      expect(data.byMatchId[foreign]).toBeUndefined();
      expect(data.byMatchId[current]).toEqual({ commentators: [{ userId: fixture.adminA, name: "解说1" }], isMine: true, canClaim: false });
      expect(data.byMatchId[others]).toEqual({ commentators: [{ userId: fixture.adminB, name: "解说2" }], isMine: false, canClaim: true });
      expect(data.byMatchId[finished]?.canClaim).toBe(false);
      expect(data.byMatchId[cancelled]?.canClaim).toBe(false);
      expect(JSON.stringify(data)).not.toContain("@local.test");

      const excluded = await readAdminMatchCommentary(fixture.database, { seasonId: fixture.seasonId, currentUserId: fixture.adminA, excludeMatchId: next });
      expect(excluded.nextMatch?.id).toBe(later);
      expect(excluded.byMatchId[next]?.isMine).toBe(true);
      const excludedClaimable = await readAdminMatchCommentary(fixture.database, { seasonId: fixture.seasonId, currentUserId: fixture.adminA, excludeMatchId: others });
      expect(excludedClaimable.claimableMatches.map((match) => match.id)).toEqual(unclaimed);
      expect(excludedClaimable.byMatchId[others]?.canClaim).toBe(true);
      const superView = await readAdminMatchCommentary(fixture.database, { seasonId: fixture.seasonId, currentUserId: fixture.superAdmin });
      expect(Object.values(superView.byMatchId).every((assignment) => !assignment.canClaim)).toBe(true);
      expect(superView.claimableMatches).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});
