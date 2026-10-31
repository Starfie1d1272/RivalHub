import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { applyResultCorrectionInTx, planResultCorrectionInTx } from "@/lib/match-corrections/service";
import { finalizeMajorSwissRoundInTransaction } from "@/lib/major/swiss-runtime";
import { balanceOf, lockPredictionProgram, openPredictionMarketInTx, reconcilePredictionProgram, stakeInTx } from "@/lib/predictions/service";
import { failureClass } from "./failure-class";
import { predictionCapacityFixture } from "./prediction-fixture";

it.skipIf(process.env.RIVALHUB_CORRECTION_CAPACITY !== "1")("measures late stakes during a held correction transaction", async () => {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(process.env.RIVALHUB_CAPACITY_SHA ?? "") || sha !== process.env.RIVALHUB_CAPACITY_SHA) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-correction-capacity.test.ts", "tests/integration/db/capacity/failure-class.ts"]);
  const paths = ["tests/integration/db/capacity/failure-class.ts", "tests/integration/db/capacity/prediction-correction-capacity.test.ts", "tests/integration/db/capacity/prediction-fixture.ts", "src/lib/predictions/service.ts", "src/lib/match-corrections/service.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch per round; 32-team Major, one settled market, two accounts with 100 points each staked on opposite options; one correction holder plus late stakes",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, heldSqlSleepMs: 200, sampledQueueStop: 8, stopOnUnexpected: true }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await predictionCapacityFixture(async f => {
          f.pool.options.connectionTimeoutMillis = 2000;
          const monitor = new Pool({ connectionString: f.pool.options.connectionString, ssl: false, max: 1, connectionTimeoutMillis: 2000 });
          try {
            const opened = await f.db.transaction(tx => openPredictionMarketInTx(tx, { seasonId: f.seasonId, actorId: "test", matchId: f.matchIds[0]!, deadline: new Date(Date.now() + 1800000) }));
            const options = await f.db.select().from(schema.predictionMarketOptions).where(eq(schema.predictionMarketOptions.marketId, opened.id)).orderBy(schema.predictionMarketOptions.position);
            const base = { seasonId: f.seasonId, userId: f.userId, marketId: opened.id, optionId: options[0]!.id, amount: "100", requestId: randomUUID() };
            await f.db.transaction(tx => stakeInTx(tx, base));
            await f.db.transaction(tx => stakeInTx(tx, { ...base, userId: f.otherId, optionId: options[1]!.id, requestId: randomUUID() }));
            await f.db.update(schema.matches).set({ status: "finished", scoreA: 1, scoreB: 0, completedAt: new Date() }).where(and(eq(schema.matches.majorStageRunId, f.runId), eq(schema.matches.round, 1)));
            await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
            const reconcile = () => f.db.transaction(async tx => reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId)));
            await reconcile();
            const accounts = await f.db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.seasonId, f.seasonId));
            const balance = (userId: string) => f.db.transaction(tx => balanceOf(tx, accounts.find(a => a.userId === userId)!.id));
            expect(await balance(f.userId)).toBe(BigInt(1100)); expect(await balance(f.otherId)).toBe(BigInt(900));
            const correctionInput = { matchId: f.matchIds[0]!, proposal: { scoreA: 0, scoreB: 1 }, actorId: "test", confirmRecovery: true };
            expect((await f.db.transaction(tx => planResultCorrectionInTx(tx, correctionInput))).winnerChanges).toBe(true);
            let release!: () => void; let ready!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; }); const locked = new Promise<void>(resolve => { ready = resolve; });
            const correction = f.db.transaction(async tx => {
              const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock`);
              expect(settings.rows[0]).toMatchObject({ statement: "5s", lock: "2s" });
              await applyResultCorrectionInTx(tx, correctionInput);
              await reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId));
              ready(); await gate;
              await tx.execute(sql`select pg_sleep(0.2)`);
            });
            const requests = Array.from({ length: concurrency }, (_, index) => ({ id: randomUUID(), userId: index % 2 ? f.otherId : f.userId, totalMs: 0, acquireAndBeginMs: null as number | null, transactionMs: null as number | null, result: "unknown", settings: null as { statement: string; lock: string } | null }));
            let tasks: Promise<void>[] = []; let maxQueue = 0; let observedLock = false; let elapsedMs = 0;
            const sampler = setInterval(() => { maxQueue = Math.max(maxQueue, f.pool.waitingCount); }, 5);
            try {
              await Promise.race([locked, correction.then(() => { throw new Error("CORRECTION_ENDED_BEFORE_BARRIER"); })]);
              const start = performance.now();
              tasks = requests.map(async request => {
                const at = performance.now(); let began: number | undefined;
                try {
                  await f.db.transaction(async tx => {
                    began = performance.now(); request.acquireAndBeginMs = began - at;
                    const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock, set_config('application_name','prediction-correction-load',true) as application`);
                    request.settings = settings.rows[0] as { statement: string; lock: string };
                    if (request.settings.statement !== "5s" || request.settings.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                    await stakeInTx(tx, { ...base, userId: request.userId, requestId: request.id });
                  });
                  request.result = "unexpected_success";
                } catch (error) {
                  request.result = error instanceof Error && /关闭|截止|锁定/.test(error.message) ? "expected_closed" : failureClass(error);
                } finally { const end = performance.now(); request.totalMs = end - at; if (began !== undefined) request.transactionMs = end - began; }
              });
              const deadline = Date.now() + 1200;
              while (Date.now() < deadline) {
                const sample = await monitor.query("select 1 from pg_stat_activity where application_name = 'prediction-correction-load' and wait_event_type = 'Lock'");
                if (sample.rowCount) { observedLock = true; break; }
                await delay(10);
              }
              release(); await correction; await Promise.all(tasks); elapsedMs = performance.now() - start;
            } finally { release(); clearInterval(sampler); await correction.catch(() => undefined); await Promise.allSettled(tasks); }
            const stored = await f.db.select({ requestId: schema.predictionStakes.requestId }).from(schema.predictionStakes);
            const outcomes = requests.map(request => ({ totalMs: request.totalMs, acquireAndBeginMs: request.acquireAndBeginMs, transactionMs: request.transactionMs, result: request.result, settings: request.settings, observedCommitted: stored.some(row => row.requestId === request.id) }));
            expect(await balance(f.userId)).toBe(BigInt(900)); expect(await balance(f.otherId)).toBe(BigInt(900));
            await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
            await reconcile();
            expect(await balance(f.userId)).toBe(BigInt(900)); expect(await balance(f.otherId)).toBe(BigInt(1100));
            await reconcile(); expect(await balance(f.userId)).toBe(BigInt(900)); expect(await balance(f.otherId)).toBe(BigInt(1100));
            expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.result.corrected")).toHaveLength(1);
            const unexpected = !observedLock || outcomes.some(item => item.result !== "expected_closed" || item.observedCommitted);
            stop = unexpected || maxQueue >= 8;
            if (stop) report.stopped = unexpected ? "unexpected_result" : "sampled_pool_queue";
            report.rounds.push({ concurrency, round, elapsedMs, maxPoolQueueSampled: maxQueue, observedLock, balancesVerified: true, outcomes });
          } finally { await monitor.end(); }
        }, 32);
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally { if (process.env.RIVALHUB_CORRECTION_CAPACITY_REPORT) writeFileSync(process.env.RIVALHUB_CORRECTION_CAPACITY_REPORT, JSON.stringify(report, null, 2)); }
  expect(report.stopped).not.toBe("unexpected_result");
}, 180000);
