import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ actorId: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: async () => ({ userId: state.actorId }),
  requireSeasonAdmin: async () => ({ userId: state.actorId }),
  auditActorId: (session: { userId: string }) => session.userId,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { castMatchMvpVote, deletePlayerStatsByMap, getOperatorScoreboardSnapshot, savePlayerStats } from "@/actions/player-stats";
import { confirmMatchRosterInTx } from "@/lib/match-rosters/service";
import { seedFixture } from "./harness/mizar";
import { createLocalPool } from "./harness/database";

// Observe real blocked sessions, not SQL-builder mocks or timing assumptions.
it("takes the season fence before roster/match/map children for confirm, save, clear and vote", async () => {
  const f = await seedFixture({ matchStatus: "scheduled", unboundSource: true, freezeEventRoster: true });
  const entry = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) });
  state.actorId = entry!.representativeUserId;
  await db.update(schema.users).set({ createdAt: new Date(Date.now() - 48 * 3600_000) }).where(eq(schema.users.id, state.actorId));
  const rosters = await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, f.matchId));
  for (const roster of rosters) await db.update(schema.matchRosters).set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: state.actorId }).where(eq(schema.matchRosters.id, roster.id));
  for (const mapId of [f.mapOneId, f.mapTwoId]) await db.update(schema.matchMaps).set({ scoreA: 13, scoreB: 8, completedAt: new Date() }).where(eq(schema.matchMaps.id, mapId));
  const pool = createLocalPool({ max: 2 });
  const holder = await pool.connect();
  const [{ pid }] = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows;
  async function underFence<T>(work: () => Promise<T>): Promise<T> {
    await holder.query("begin");
    await holder.query("select id from seasons where id=$1 for update", [f.seasonId]);
    const running = work();
    // Prevent an unexpected early rejection from becoming unhandled while the
    // observer diagnoses why no canonical fence was reached.
    void running.catch(() => undefined);
    try {
      const deadline = Date.now() + 5000;
      for (;;) {
        const blocked = await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and datname=current_database()", [pid]);
        if (blocked.rows.length) break;
        if (Date.now() >= deadline) throw new Error("consumer did not wait on its canonical season fence");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      // The blocked consumer must not retain the old child-first cycle.
      await holder.query("select id from matches where id=$1 for update nowait", [f.matchId]);
      await holder.query("select id from match_rosters where match_id=$1 for update nowait", [f.matchId]);
      await holder.query("select id from match_maps where match_id=$1 for update nowait", [f.matchId]);
      await holder.query("commit");
      return await running;
    } catch (error) {
      await holder.query("rollback");
      await running.catch(() => undefined);
      throw error;
    }
  }
  try {
    expect(await underFence(() => db.transaction(tx => confirmMatchRosterInTx(tx, { rosterId: rosters[0]!.id, actorId: state.actorId })))).toMatchObject({ alreadyConfirmed: true });
    await db.update(schema.matches).set({ status: "finished", scoreA: 2, scoreB: 0, completedAt: new Date() }).where(eq(schema.matches.id, f.matchId));
    await db.update(schema.seasons).set({ status: "archived" }).where(eq(schema.seasons.id, f.seasonId));
    const snapshot = await getOperatorScoreboardSnapshot(f.mapOneId);
    if (!snapshot.success) throw new Error("fixture scoreboard unavailable");
    expect(await underFence(() => savePlayerStats(f.mapOneId, { operationId: randomUUID(), expectedVersion: snapshot.data.version, rows: [] }))).toMatchObject({ success: true });
    const saved = await getOperatorScoreboardSnapshot(f.mapOneId);
    if (!saved.success) throw new Error("fixture saved scoreboard unavailable");
    expect(await underFence(() => deletePlayerStatsByMap(f.mapOneId, { operationId: randomUUID(), expectedVersion: saved.data.version }))).toMatchObject({ success: true });
    expect(await underFence(() => castMatchMvpVote(f.matchId, state.actorId))).toMatchObject({ success: true });
    await db.update(schema.matches).set({ mvpWinnerUserId: state.actorId }).where(eq(schema.matches.id, f.matchId));
    expect(await castMatchMvpVote(f.matchId, state.actorId)).toMatchObject({ success: false, error: { code: "MATCH_INVALID_TRANSITION" } });
    await db.update(schema.matches).set({ mvpWinnerUserId: null, completedAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.matches.id, f.matchId));
    expect(await castMatchMvpVote(f.matchId, state.actorId)).toMatchObject({ success: false, error: { code: "MATCH_INVALID_TRANSITION" } });
  } finally { await holder.query("rollback"); holder.release(); await pool.end(); }
});
