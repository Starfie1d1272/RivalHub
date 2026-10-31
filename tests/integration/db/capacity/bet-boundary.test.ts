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
import { failureClass } from "./failure-class";
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

it.skipIf(process.env.RIVALHUB_BET_START_CAPACITY !== "1")("measures stakes queued behind canonical map start", async () => {
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { Pool } = await import("pg");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sha !== process.env.RIVALHUB_CAPACITY_SHA || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/harness/bet-fixture.ts", "tests/integration/db/capacity/bet-boundary.test.ts", "tests/integration/db/capacity/failure-class.ts"]);
  const paths = ["tests/integration/db/capacity/failure-class.ts", "tests/integration/db/capacity/bet-boundary.test.ts", "tests/integration/db/harness/bet-fixture.ts", "src/lib/matches/map-start.ts", "src/lib/bet/service.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch per round; one Major, two accounts, completed BO3 veto, canonical start holder and alternating late stakes",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, heldSqlSleepMs: 200, sampledQueueStop: 8, stopOnUnexpected: true, disconnectMonitor: process.env.RIVALHUB_BET_SAMPLE_DISCONNECT === "1" }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await fixture(async f => {
          f.db.$client.options.connectionTimeoutMillis = 2000;
          const monitor = new Pool({ connectionString: f.db.$client.options.connectionString, ssl: false, max: 1 });
          try {
            const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
            const mapId = await prepareStart(f);
            let release!: () => void; let ready!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const locked = new Promise<void>(resolve => { ready = resolve; });
            const holder = f.db.transaction(async tx => {
              await tx.execute(sql`set local lock_timeout = '2s'`); await tx.execute(sql`set local statement_timeout = '5s'`);
              await start(f, mapId, tx); ready(); await gate; await tx.execute(sql`select pg_sleep(0.2)`);
            });
            const requests = Array.from({ length: concurrency }, (_, i) => ({ id: randomUUID(), userId: i % 2 ? f.otherId : f.userId, totalMs: 0, acquisitionMs: null as number | null, transactionMs: null as number | null, result: "unknown", settings: null as object | null }));
            let maxQueue = 0; let waiting = 0; let tasks: Promise<void>[] = []; let samplingFailure: string | undefined; let recorded = false;
            const sampler = setInterval(() => { maxQueue = Math.max(maxQueue, f.db.$client.waitingCount); }, 5);
            try {
              await Promise.race([locked, holder.then(() => { throw new Error("HOLDER_ENDED_BEFORE_BARRIER"); })]);
              const at = performance.now();
              tasks = requests.map(async request => {
                const begin = performance.now(); let acquired: number | undefined;
                try {
                  await f.db.transaction(async tx => {
                    acquired = performance.now(); request.acquisitionMs = acquired - begin;
                    const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock, set_config('application_name','bet-start-load',true) as application`);
                    request.settings = settings.rows[0];
                    if (settings.rows[0]?.statement !== "5s" || settings.rows[0]?.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                    await stakeBetInTx(tx, { seasonId: f.seasonId, userId: request.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: request.id });
                  });
                  request.result = "unexpected_success";
                } catch (error) { request.result = error instanceof Error && /锁定/.test(error.message) ? "expected_locked" : failureClass(error); }
                finally { const end = performance.now(); request.totalMs = end - begin; if (acquired !== undefined) request.transactionMs = end - acquired; }
              });
              const deadline = Date.now() + 1200;
              while (Date.now() < deadline) {
                const sample = await monitor.query("select count(*)::int as count from pg_stat_activity where application_name = 'bet-start-load' and wait_event_type = 'Lock'").catch(error => { samplingFailure = failureClass(error); return null; });
                if (!sample) break;
                waiting = sample.rows[0].count;
                if (waiting >= Math.min(concurrency, 5)) {
                  // This opt-in fault terminates only the scratch monitor's own backend.
                  if (process.env.RIVALHUB_BET_SAMPLE_DISCONNECT === "1") {
                    await monitor.query("select pg_terminate_backend(pg_backend_pid())").catch(error => { samplingFailure = failureClass(error); });
                    samplingFailure ??= "fault_injection_not_observed";
                  }
                  break;
                }
                await delay(10);
              }
              release(); await holder; await Promise.all(tasks);
              const elapsedMs = performance.now() - at;
              const stored = await f.db.select().from(schema.betStakes);
              const outcomes = requests.map(request => ({ ...request, id: undefined, userId: undefined, observedCommitted: stored.some(row => row.requestId === request.id) }));
              const unexpected = !!samplingFailure || waiting < Math.min(concurrency, 5) || outcomes.some(item => item.result !== "expected_locked" || item.observedCommitted) || stored.length !== 0;
              stop = unexpected || maxQueue >= 8;
              if (stop) report.stopped = unexpected ? "unexpected_or_sampling_failure" : "sampled_pool_queue";
              expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("1000");
              expect((await read(f.db, f.seasonId, f.otherId)).balance).toBe("1000");
              expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.map.start")).toHaveLength(1);
              report.rounds.push({ concurrency, round, elapsedMs, requestsPerSecond: concurrency / (elapsedMs / 1000), observedLockWaiters: waiting, maxPoolQueueSampled: maxQueue, outcomes, balancesVerified: true, samplingFailure, timingIncludesArtificialBarrier: true });
              recorded = true;
            } catch (error) {
              if (!samplingFailure || recorded) throw error;
              release(); await holder.catch(() => undefined); await Promise.allSettled(tasks);
              let stored: Array<{ requestId: string }> | undefined; let readbackFailure: string | undefined;
              try { stored = await f.db.select({ requestId: schema.betStakes.requestId }).from(schema.betStakes); }
              catch (readError) { readbackFailure = failureClass(readError); }
              stop = true; report.stopped = "unexpected_or_sampling_failure";
              report.rounds.push({ concurrency, round, samplingFailure, operationFailure: failureClass(error), readbackFailure, outcomes: requests.map(request => ({ ...request, id: undefined, userId: undefined, observedCommitted: stored?.some(row => row.requestId === request.id) ?? null })) });
            } finally { release(); clearInterval(sampler); await holder.catch(() => undefined); await Promise.allSettled(tasks); }
          } finally { await monitor.end(); }
        });
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally { if (process.env.RIVALHUB_BET_START_REPORT) writeFileSync(process.env.RIVALHUB_BET_START_REPORT, JSON.stringify(report, null, 2)); }
  expect(report.stopped).not.toBe("unexpected_or_sampling_failure");
}, 180000);

it("rolls back timed-out BET and start transactions and recovers after releasing locks", async () => {
  await fixture(async f => {
    const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
    const mapId = await prepareStart(f);
    const args = { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() };
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const holder = f.db.transaction(async tx => {
      await start(f, mapId, tx); ready(); await gate;
      throw new Error("ROLLBACK_TEST_HOLDER");
    });
    void holder.catch(() => undefined);
    try {
      await Promise.race([locked, holder.then(() => { throw new Error("HOLDER_ENDED_BEFORE_BARRIER"); })]);
      let failure: unknown;
      try { await f.db.transaction(async tx => { await tx.execute(sql`set local lock_timeout = '100ms'`); await stakeBetInTx(tx, args); }); }
      catch (error) { failure = error; }
      const codes: unknown[] = [];
      for (let value = failure, depth = 0; value && depth < 5; depth++) {
        if (typeof value !== "object") break;
        const item = value as { code?: unknown; cause?: unknown }; codes.push(item.code); value = item.cause;
      }
      expect(codes).toContain("55P03");
    } finally { release(); await holder.catch(() => undefined); }
    expect(await f.db.select().from(schema.betStakes)).toHaveLength(0);
    await f.db.transaction(tx => stakeBetInTx(tx, { ...args, requestId: randomUUID() }));
    expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("999");
    let failure: unknown;
    try {
      await f.db.transaction(async tx => {
        await tx.execute(sql`set local statement_timeout = '100ms'`);
        await start(f, mapId, tx);
        await tx.execute(sql`select pg_sleep(1)`);
      });
    } catch (error) { failure = error; }
    const codes: unknown[] = [];
    for (let value = failure, depth = 0; value && depth < 5; depth++) {
      if (typeof value !== "object") break;
      const item = value as { code?: unknown; cause?: unknown }; codes.push(item.code); value = item.cause;
    }
    expect(codes).toContain("57014");
    expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.map.start")).toHaveLength(0);
    await f.db.transaction(tx => start(f, mapId, tx));
    expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.map.start")).toHaveLength(1);
  });
}, 30000);
