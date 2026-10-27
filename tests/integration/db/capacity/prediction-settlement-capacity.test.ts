import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { finalizeMajorSwissRoundInTransaction } from "@/lib/major/swiss-runtime";
import { balanceOf, lockPredictionProgram, openPredictionMarketInTx, reconcilePredictionProgram, stakeInTx } from "@/lib/predictions/service";
import { predictionCapacityFixture } from "./prediction-fixture";

it.skipIf(process.env.RIVALHUB_SETTLEMENT_CAPACITY !== "1")("measures settlement and known committed stake replays in both legitimate lock holders", async () => {
  const order = process.env.RIVALHUB_SETTLEMENT_ORDER;
  if (order !== "reconcile-holder" && order !== "stake-holder") throw new Error("SETTLEMENT_ORDER_REQUIRED");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(process.env.RIVALHUB_CAPACITY_SHA ?? "") || sha !== process.env.RIVALHUB_CAPACITY_SHA) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-settlement-capacity.test.ts"]);
  const paths = ["tests/integration/db/capacity/prediction-settlement-capacity.test.ts", "tests/integration/db/capacity/prediction-fixture.ts", "src/lib/predictions/service.ts", "src/lib/major/swiss-runtime.ts"];
  const report: { sha: string; order: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, order, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch per round; 32-team Major; two known committed 100-point opposite stakes; official first round finalized; settlement not yet applied",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, sampledQueueStop: 8, stopOnUnexpected: true }, rounds: [],
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
            const stakes = [f.userId, f.otherId].map((userId, i) => ({ seasonId: f.seasonId, userId, marketId: opened.id, optionId: options[i]!.id, amount: "100", requestId: randomUUID() }));
            // These exact keys are known committed before the race; unknown writes are never replayed.
            for (const stake of stakes) await f.db.transaction(tx => stakeInTx(tx, stake));
            expect(await f.db.select().from(schema.predictionStakes).where(eq(schema.predictionStakes.marketId, opened.id))).toHaveLength(2);
            await f.db.update(schema.matches).set({ status: "finished", scoreA: 1, scoreB: 0, completedAt: new Date() }).where(and(eq(schema.matches.majorStageRunId, f.runId), eq(schema.matches.round, 1)));
            await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
            const pre = await f.db.select().from(schema.predictionSettlements).where(and(eq(schema.predictionSettlements.marketId, opened.id), eq(schema.predictionSettlements.state, "settled")));
            expect(pre).toHaveLength(0);
            let release!: () => void; let ready!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; }); const locked = new Promise<void>(resolve => { ready = resolve; });
            const holderStarted = performance.now(); let holderMs = 0;
            const holder = f.db.transaction(async tx => {
              const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock`);
              expect(settings.rows[0]).toMatchObject({ statement: "5s", lock: "2s" });
              if (order === "reconcile-holder") await reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId));
              else expect(await stakeInTx(tx, stakes[0]!)).toMatchObject({ amount: "100" });
              ready(); await gate;
            }).finally(() => { holderMs = performance.now() - holderStarted; });
            void holder.catch(() => undefined);
            let tasks: Promise<void>[] = []; let maxQueue = 0; let lockObserved = false; let elapsedMs = 0; let phaseFailure = false;
            const requests = Array.from({ length: concurrency }, () => ({ totalMs: 0, acquireAndBeginMs: null as number | null, transactionMs: null as number | null, result: "unknown", settings: null as { statement: string; lock: string } | null }));
            const sample = setInterval(() => { maxQueue = Math.max(maxQueue, f.pool.waitingCount); }, 5);
            try {
              await Promise.race([locked, holder.then(() => { throw new Error("HOLDER_ENDED_BEFORE_BARRIER"); })]);
              const at = performance.now();
              tasks = requests.map(async (request, index) => {
                const started = performance.now(); let began: number | undefined;
                try {
                  await f.db.transaction(async tx => {
                    began = performance.now(); request.acquireAndBeginMs = began - started;
                    const values = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock, set_config('application_name','prediction-settlement-load',true) as application`);
                    request.settings = values.rows[0] as { statement: string; lock: string };
                    if (request.settings.statement !== "5s" || request.settings.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                    if (order === "reconcile-holder") expect(await stakeInTx(tx, stakes[index % 2]!)).toMatchObject({ amount: "100" });
                    else await reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId));
                  });
                  request.result = "success";
                } catch (error) {
                  const item = error as { code?: string; message?: string; cause?: { code?: string } }; const code = item?.code ?? item?.cause?.code;
                  request.result = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? `sqlstate_${code}` : /timeout exceeded when trying to connect/i.test(item?.message ?? "") ? "pool_acquisition_timeout" : "unknown";
                } finally { const ended = performance.now(); request.totalMs = ended - started; if (began !== undefined) request.transactionMs = ended - began; }
              });
              const deadline = Date.now() + 1200;
              while (Date.now() < deadline) {
                const waiting = await monitor.query("select 1 from pg_stat_activity where application_name = 'prediction-settlement-load' and wait_event_type = 'Lock'");
                if (waiting.rowCount) { lockObserved = true; break; }
                await delay(10);
              }
              release(); await holder; await Promise.all(tasks); elapsedMs = performance.now() - at;
            } catch { phaseFailure = true; } finally { release(); clearInterval(sample); await holder.catch(() => undefined); await Promise.allSettled(tasks); }
            const settled = await f.db.select().from(schema.predictionSettlements).where(and(eq(schema.predictionSettlements.marketId, opened.id), eq(schema.predictionSettlements.state, "settled")));
            const ledger = await f.db.select().from(schema.predictionLedger).where(and(eq(schema.predictionLedger.seasonId, f.seasonId), eq(schema.predictionLedger.kind, "settlement")));
            const allStakes = await f.db.select().from(schema.predictionStakes).where(eq(schema.predictionStakes.marketId, opened.id));
            const accounts = await f.db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.seasonId, f.seasonId));
            const balance = (userId: string) => f.db.transaction(tx => balanceOf(tx, accounts.find(a => a.userId === userId)!.id));
            const balances = await Promise.all([balance(f.userId), balance(f.otherId)]);
            const valid = settled.length === 1 && allStakes.length === 2 && ledger.length === 2 && new Set(ledger.map(row => row.accountId)).size === 2 && balances[0] === BigInt(1100) && balances[1] === BigInt(900);
            const unexpected = phaseFailure || !valid || !lockObserved || requests.some(request => request.result !== "success");
            stop = unexpected || maxQueue >= 8;
            if (stop) report.stopped = unexpected ? "unexpected_or_unknown" : "sampled_pool_queue";
            report.rounds.push({ concurrentTasks: concurrency, totalTransactions: concurrency + 1, round, elapsedMs, holderMs, phaseFailure, maxPoolQueueSampled: maxQueue, lockObserved, settlementCount: settled.length, stakeCount: allStakes.length, settlementLedgerCount: ledger.length, balancesVerified: valid, requests });
            expect(valid).toBe(true);
            if (!unexpected) {
              // All outcomes are known; a new reconciliation verifies idempotency.
              await f.db.transaction(async tx => reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId)));
              expect(await f.db.select().from(schema.predictionSettlements).where(and(eq(schema.predictionSettlements.marketId, opened.id), eq(schema.predictionSettlements.state, "settled")))).toHaveLength(1);
              expect(await f.db.select().from(schema.predictionLedger).where(and(eq(schema.predictionLedger.seasonId, f.seasonId), eq(schema.predictionLedger.kind, "settlement")))).toHaveLength(2);
              // A new key is not an idempotent replay; the already finished match cannot accept it.
              await expect(f.db.transaction(tx => stakeInTx(tx, { ...stakes[0]!, requestId: randomUUID() }))).rejects.toThrow(/关闭/);
              expect(await f.db.select().from(schema.predictionStakes).where(eq(schema.predictionStakes.marketId, opened.id))).toHaveLength(2);
            }
          } finally { await monitor.end(); }
        }, 32);
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally { if (process.env.RIVALHUB_SETTLEMENT_CAPACITY_REPORT) writeFileSync(process.env.RIVALHUB_SETTLEMENT_CAPACITY_REPORT, JSON.stringify(report, null, 2)); }
}, 180000);
