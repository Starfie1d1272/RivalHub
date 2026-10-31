import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { startCanonicalMapInTx } from "@/lib/matches/map-start";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "../harness/bet-fixture";

async function waitForLock(pool: Pool, name: string) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [name]);
    if (result.rowCount) return;
    await delay(10);
  }
  throw new Error("EXPECTED_LOCK_WAIT_NOT_OBSERVED");
}

type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
async function prepareStart(f: Fixture) {
  const pool = ["de_ancient", "de_anubis", "de_dust2", "de_inferno", "de_mirage", "de_nuke", "de_overpass"];
  await f.db.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.id, f.matchId));
  await f.db.insert(schema.matchVetoSessions).values({ matchId: f.matchId, startedAt: new Date(), completedAt: new Date(), mapPoolSnapshot: pool });
  await f.db.insert(schema.matchVetoSteps).values([3, 4, 0, 1, 5, 6, 2].map((index, i) => ({ matchId: f.matchId, stepOrder: i + 1, mapName: pool[index]!, actionType: i === 6 ? "decider" as const : i === 2 || i === 3 ? "pick" as const : "ban" as const })));
  const maps = await f.db.insert(schema.matchMaps).values(pool.slice(0, 3).map((mapName, i) => ({ matchId: f.matchId, mapOrder: i + 1, mapName }))).returning();
  return maps[0]!.id;
}
async function start(f: Fixture, mapId: string, tx: Parameters<Parameters<Fixture["db"]["transaction"]>[0]>[0]) {
  await assertSeasonAllowsTournamentMutationInTx(tx, f.seasonId);
  const match = await lockMatchInTx(tx, f.matchId);
  expect(match.seasonId).toBe(f.seasonId);
  await startCanonicalMapInTx(tx, match.id, mapId, f.userId);
}

// Force both orders across the gameplay boundary using the canonical start owner.
it("serializes BET submission and gameplay start in both lock orders", async () => {
  await fixture(async f => {
    const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
    const args = { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() };
    const mapId = await prepareStart(f);
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const starter = f.db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await start(f, mapId, tx);
      ready(); await gate;
    });
    let submission: Promise<unknown> | undefined;
    try {
      await Promise.race([locked, starter.then(() => { throw new Error("START_ENDED_BEFORE_BARRIER"); })]);
      submission = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local application_name = 'bet-boundary-submit'`);
        return stakeBetInTx(tx, args);
      });
      void submission.catch(() => undefined);
      await waitForLock(f.db.$client, "bet-boundary-submit");
      release(); await starter;
      await expect(submission).rejects.toThrow(/锁定/);
      expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("1000");
      expect(await f.db.select().from(schema.betStakes)).toHaveLength(0);
      expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.map.start")).toHaveLength(1);
    } finally { release(); await starter.catch(() => undefined); await submission?.catch(() => undefined); }
  });
  await fixture(async f => {
    const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
    const args = { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() };
    const mapId = await prepareStart(f);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let ready!: () => void;
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const submission = f.db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await stakeBetInTx(tx, args);
      ready();
      await barrier;
    });
    try {
      await Promise.race([locked, submission.then(() => { throw new Error("SUBMISSION_ENDED_BEFORE_BARRIER"); })]);
      const starter = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local application_name = 'bet-boundary-start'`);
        await start(f, mapId, tx);
      });
      try {
        void starter.catch(() => undefined);
        await waitForLock(f.db.$client, "bet-boundary-start");
        release(); await submission; await starter;
      } finally { release(); await starter.catch(() => undefined); }
      await f.db.transaction(tx => start(f, mapId, tx));
      expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.map.start")).toHaveLength(1);
      await f.db.transaction(tx => stakeBetInTx(tx, args));
      expect(await f.db.select().from(schema.betStakes)).toHaveLength(1);
      expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("999");
      await expect(f.db.transaction(tx => stakeBetInTx(tx, { ...args, requestId: randomUUID() }))).rejects.toThrow(/锁定/);
    } finally { release(); await submission.catch(() => undefined); }
  });
}, 30000);
