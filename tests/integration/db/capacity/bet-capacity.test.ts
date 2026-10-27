import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { betBalance, stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "../harness/bet-fixture";

function failureClass(error: unknown): string {
  for (let value: unknown = error, depth = 0; value && depth < 5; depth++) {
    if (typeof value !== "object") break;
    const item = value as { code?: unknown; message?: unknown; cause?: unknown };
    if (item.code === "55P03") return "lock_timeout";
    if (item.code === "57014") return "statement_timeout_or_cancel";
    if (typeof item.code === "string" && /^[A-Z0-9]{5}$/.test(item.code)) return `sqlstate_${item.code}`;
    if (typeof item.message === "string" && /timeout exceeded when trying to connect/i.test(item.message)) return "pool_acquisition_timeout";
    value = item.cause;
  }
  return "unknown";
}

// This opt-in experiment uses only the fixture's scratch databases.
it.skipIf(process.env.RIVALHUB_BET_CAPACITY !== "1")("measures independent same-account BET rounds and verifies committed outcomes", async () => {
  const expectedSha = process.env.RIVALHUB_CAPACITY_SHA;
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!expectedSha || expectedSha !== sha || !/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/harness/bet-fixture.ts", "tests/integration/db/capacity/bet-capacity.test.ts"]);
  const source = ["src/lib/bet/service.ts", "tests/integration/db/harness/bet-fixture.ts", "tests/integration/db/capacity/bet-capacity.test.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; boundary?: object; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(source.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch database per round: one Major, one match, two joined accounts, seven markets, no stakes; one unit per request",
    limits: { poolMax: 6, poolAcquireTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, stopOnAnyFailure: true, stopAtSampledPoolQueue: 8 }, rounds: [],
  };
  let stopped = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stopped; round++) {
        await fixture(async f => {
          const pool = f.db.$client;
          pool.options.connectionTimeoutMillis = 2000;
          const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
          const account = await f.db.query.betAccounts.findFirst({ where: eq(schema.betAccounts.userId, f.userId) });
          expect(account).toBeDefined();
          expect(await f.db.select().from(schema.betStakes)).toHaveLength(0);
          expect(await f.db.transaction(tx => betBalance(tx, account!.id))).toBe(BigInt(1000));
          let maxQueue = 0;
          const samples = setInterval(() => { maxQueue = Math.max(maxQueue, pool.waitingCount); }, 5);
          const requests = Array.from({ length: concurrency }, () => ({ id: randomUUID(), totalMs: 0, acquireAndBeginMs: null as number | null, transactionMs: null as number | null, failure: null as string | null, effectiveTimeouts: null as { statement: string; lock: string } | null }));
          const started = performance.now();
          try {
            await Promise.all(requests.map(async request => {
              const at = performance.now();
              let began: number | undefined;
              try {
                await f.db.transaction(async tx => {
                  began = performance.now();
                  request.acquireAndBeginMs = began - at;
                  const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock`);
                  const row = settings.rows[0] as { statement: string; lock: string };
                  request.effectiveTimeouts = row;
                  if (row.statement !== "5s" || row.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                  await stakeBetInTx(tx, { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: request.id });
                });
              } catch (error) { request.failure = failureClass(error); }
              finally {
                const end = performance.now();
                request.totalMs = end - at;
                if (began !== undefined) request.transactionMs = end - began;
              }
            }));
          } finally { clearInterval(samples); }
          const elapsedMs = performance.now() - started;
          // Reconcile once, read-only, after all calls have settled. Never resend an unknown write.
          const stored = await f.db.select({ requestId: schema.betStakes.requestId }).from(schema.betStakes).where(eq(schema.betStakes.accountId, account!.id));
          const committed = new Set(stored.map(row => row.requestId));
          const outcomes = requests.map(({ id, ...request }) => ({ ...request, observedCommitted: committed.has(id), outcome: committed.has(id) ? "committed" : request.failure ? "unresolved" : "missing" }));
          expect(stored.length).toBe(committed.size);
          expect(outcomes.filter(item => !item.failure && !item.observedCommitted)).toHaveLength(0);
          expect(await f.db.transaction(tx => betBalance(tx, account!.id))).toBe(BigInt(1000) - BigInt(stored.length));
          const failure = outcomes.some(item => item.failure);
          stopped = failure || maxQueue >= 8;
          if (stopped) report.stopped = failure ? "request_failure" : "sampled_pool_queue";
          report.rounds.push({ concurrency, round, elapsedMs, maxPoolQueueSampled: maxQueue, outcomes, committed: stored.length, balanceVerified: true });
          // A fresh request establishes post-load recovery; it is not a replay of any failed request.
          if (!failure) {
            await f.db.transaction(tx => stakeBetInTx(tx, { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() }));
            expect(await f.db.transaction(tx => betBalance(tx, account!.id))).toBe(BigInt(999) - BigInt(stored.length));
          }
        });
      }
      if (stopped) break;
    }
    await fixture(async f => {
      const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
      const args = { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() };
      await f.db.transaction(tx => stakeBetInTx(tx, args));
      await f.db.transaction(tx => stakeBetInTx(tx, args));
      expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("999");
      await f.db.update(schema.matches).set({ status: "in_progress", gameplayStartedAt: new Date() }).where(eq(schema.matches.id, f.matchId));
      await expect(f.db.transaction(tx => stakeBetInTx(tx, { ...args, requestId: randomUUID() }))).rejects.toThrow();
      expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("999");
      report.boundary = { replayChargedOnce: true, rejectedAfterGameplay: true, balanceVerified: true };
    });
    report.cleanup = true;
  } finally {
    if (process.env.RIVALHUB_CAPACITY_REPORT) writeFileSync(process.env.RIVALHUB_CAPACITY_REPORT, JSON.stringify(report, null, 2));
  }
}, 180_000);

it.skipIf(process.env.RIVALHUB_BET_CAPACITY !== "1")("bounds a held pool and a PostgreSQL row lock, then recovers", async () => {
  await fixture(async f => {
    const pool = f.db.$client;
    pool.options.connectionTimeoutMillis = 100;
    const clients = await Promise.all(Array.from({ length: 6 }, () => pool.connect()));
    try {
      let failure: unknown;
      try { const extra = await pool.connect(); extra.release(); } catch (error) { failure = error; }
      expect(failureClass(failure)).toBe("pool_acquisition_timeout");
    } finally { for (const client of clients) client.release(); }
    const holder = await pool.connect();
    const waiter = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM matches WHERE id = $1 FOR UPDATE", [f.matchId]);
      await waiter.query("BEGIN");
      await waiter.query("SET LOCAL lock_timeout = '100ms'");
      let failure: unknown;
      try { await waiter.query("SELECT id FROM matches WHERE id = $1 FOR UPDATE", [f.matchId]); } catch (error) { failure = error; }
      expect(failureClass(failure)).toBe("lock_timeout");
    } finally {
      await waiter.query("ROLLBACK");
      await holder.query("ROLLBACK");
      waiter.release();
      holder.release();
    }
    expect((await pool.query("SELECT 1 AS ready")).rows[0]?.ready).toBe(1);
  });
}, 30000);
