import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { balanceOf, savePickInTx } from "@/lib/predictions/service";
import { failureClass } from "./failure-class";
import { predictionCapacityFixture } from "./prediction-fixture";

it.skipIf(process.env.RIVALHUB_PREDICTION_CAPACITY !== "1")("measures isolated prediction drafts before and after cutoff", async () => {
  const complete = process.env.RIVALHUB_PREDICTION_COMPLETE === "1";
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(process.env.RIVALHUB_CAPACITY_SHA ?? "") || sha !== process.env.RIVALHUB_CAPACITY_SHA) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-capacity.test.ts", "tests/integration/db/capacity/failure-class.ts"]);
  const paths = ["tests/integration/db/capacity/failure-class.ts", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-capacity.test.ts", "src/lib/predictions/service.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; complete: boolean; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    complete, dataset: "fresh scratch database per round; one 24-team Major, two accounts, one PickEm contest, zero picks; alternating accounts",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, sampledQueueStop: 8, stopOnAnyFailure: true }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await predictionCapacityFixture(async f => {
          f.pool.options.connectionTimeoutMillis = 2000;
          const [contest] = await f.db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, f.seasonId));
          const entrants = contest!.entrants.map(item => item.teamId);
          const pick = complete ? { perfect: entrants.slice(0, 2), advance: entrants.slice(2, 8), eliminated: entrants.slice(8, 10) } : { perfect: [], advance: [], eliminated: [] };
          const accounts = await f.db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.seasonId, f.seasonId));
          const accountFor = (userId: string) => accounts.find(a => a.userId === userId)!;
          expect(accounts).toHaveLength(2);
          expect(await f.db.select().from(schema.predictionPicks)).toHaveLength(0);
          const initial = await Promise.all(accounts.map(a => f.db.transaction(tx => balanceOf(tx, a.id))));
          let maxQueue = 0;
          const sample = setInterval(() => { maxQueue = Math.max(maxQueue, f.pool.waitingCount); }, 5);
          const requests = Array.from({ length: concurrency }, (_, index) => ({ id: randomUUID(), userId: index % 2 ? f.otherId : f.userId, totalMs: 0, acquireAndBeginMs: null as number | null, transactionMs: null as number | null, error: null as string | null, settings: null as { statement: string; lock: string } | null }));
          const start = performance.now();
          try {
            await Promise.all(requests.map(async request => {
              const at = performance.now(); let began: number | undefined;
              try {
                await f.db.transaction(async tx => {
                  began = performance.now(); request.acquireAndBeginMs = began - at;
                  const result = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock`);
                  request.settings = result.rows[0] as { statement: string; lock: string };
                  if (request.settings.statement !== "5s" || request.settings.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                  await savePickInTx(tx, { seasonId: f.seasonId, userId: request.userId, contestId: contest!.id, pick, submitted: complete, requestId: request.id });
                });
              } catch (error) {
                const item = error as { code?: string; message?: string; cause?: { code?: string } };
                const code = item?.code ?? item?.cause?.code;
                request.error = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? `sqlstate_${code}` : /timeout exceeded when trying to connect/i.test(item?.message ?? "") ? "pool_acquisition_timeout" : "unknown";
              } finally {
                const end = performance.now(); request.totalMs = end - at;
                if (began !== undefined) request.transactionMs = end - began;
              }
            }));
          } finally { clearInterval(sample); }
          const elapsedMs = performance.now() - start;
          const stored = await f.db.select().from(schema.predictionPicks);
          const outcomes = requests.map(request => {
            const row = stored.find(item => item.requestId === request.id);
            if (row) { expect(row.accountId).toBe(accountFor(request.userId).id); expect(row.submitted).toBe(complete); }
            return { totalMs: request.totalMs, acquireAndBeginMs: request.acquireAndBeginMs, transactionMs: request.transactionMs, error: request.error, settings: request.settings, observedCommitted: !!row, outcome: row ? "committed" : request.error ? "unresolved" : "missing" };
          });
          expect(stored).toHaveLength(new Set(stored.map(row => row.requestId)).size);
          expect(outcomes.filter(item => !item.error && !item.observedCommitted)).toHaveLength(0);
          for (const [index, account] of accounts.entries()) expect(await f.db.transaction(tx => balanceOf(tx, account.id))).toBe(initial[index]);
          const failed = outcomes.some(item => item.error);
          stop = failed || maxQueue >= 8;
          if (stop) report.stopped = failed ? "request_failure" : "sampled_pool_queue";
          if (!failed) {
            await f.db.update(schema.predictionContests).set({ deadline: new Date(Date.now() - 1000) }).where(eq(schema.predictionContests.id, contest!.id));
            await expect(f.db.transaction(tx => savePickInTx(tx, { seasonId: f.seasonId, userId: f.userId, contestId: contest!.id, pick, submitted: complete, requestId: randomUUID() }))).rejects.toThrow(/截止/);
            expect(await f.db.select().from(schema.predictionPicks)).toHaveLength(stored.length);
          }
          report.rounds.push({ concurrency, round, elapsedMs, maxPoolQueueSampled: maxQueue, outcomes, cutoffVerified: !failed });
        }, 24);
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally {
    if (process.env.RIVALHUB_PREDICTION_CAPACITY_REPORT) writeFileSync(process.env.RIVALHUB_PREDICTION_CAPACITY_REPORT, JSON.stringify(report, null, 2));
  }
}, 180000);

it.skipIf(process.env.RIVALHUB_PREDICTION_WALL_CAPACITY !== "1")("measures complete submissions queued across database wall-clock cutoff", async () => {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sha !== process.env.RIVALHUB_CAPACITY_SHA || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-capacity.test.ts", "tests/integration/db/capacity/failure-class.ts"]);
  const paths = ["tests/integration/db/capacity/failure-class.ts", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-capacity.test.ts", "src/lib/predictions/service.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch per round: 24-team Major, two accounts, complete 2/6/2 picks; one successful control and one held cutoff transaction",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 3000, sampledQueueStop: 8, stopOnUnexpected: true }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await predictionCapacityFixture(async f => {
          f.pool.options.connectionTimeoutMillis = 2000;
          const { Pool } = await import("pg");
          const monitor = new Pool({ connectionString: f.pool.options.connectionString, ssl: false, max: 1 });
          try {
            const [contest] = await f.db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, f.seasonId));
            const ids = contest!.entrants.map(item => item.teamId);
            const base = { seasonId: f.seasonId, contestId: contest!.id, pick: { perfect: ids.slice(0, 2), advance: ids.slice(2, 8), eliminated: ids.slice(8, 10) }, submitted: true };
            await f.db.transaction(tx => savePickInTx(tx, { ...base, userId: f.userId, requestId: randomUUID() }));
            let release!: () => void; let ready!: (deadline: Date) => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const locked = new Promise<Date>(resolve => { ready = resolve; });
            let after: Date | undefined;
            const holder = f.db.transaction(async tx => {
              await tx.execute(sql`set local lock_timeout = '3s'`);
              await tx.execute(sql`set local statement_timeout = '5s'`);
              const { lockPredictionProgram } = await import("@/lib/predictions/service");
              await lockPredictionProgram(tx, f.seasonId);
              const result = await tx.execute<{ deadline: Date }>(sql`update prediction_contests set deadline = clock_timestamp() + interval '1 second' where id = ${contest!.id} returning deadline`);
              ready(new Date(result.rows[0]!.deadline)); await gate;
              await tx.execute(sql`select pg_sleep(1.1)`);
              after = new Date((await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`)).rows[0]!.now);
            });
            const requests = Array.from({ length: concurrency }, (_, i) => ({ id: randomUUID(), userId: i % 2 ? f.userId : f.otherId, totalMs: 0, acquisitionMs: null as number | null, transactionMs: null as number | null, result: "unknown", settings: null as object | null }));
            let tasks: Promise<void>[] = []; let maxQueue = 0; let before: Date | undefined; let waiting = 0; let samplingFailure: string | undefined; let recorded = false;
            const sampler = setInterval(() => { maxQueue = Math.max(maxQueue, f.pool.waitingCount); }, 5);
            let elapsedMs = 0;
            try {
              const deadline = await Promise.race([locked, holder.then(() => { throw new Error("HOLDER_ENDED_BEFORE_BARRIER"); })]);
              const start = performance.now();
              tasks = requests.map(async request => {
                const at = performance.now(); let began: number | undefined;
                try {
                  await f.db.transaction(async tx => {
                    began = performance.now(); request.acquisitionMs = began - at;
                    const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','3s',true) as lock, set_config('application_name','prediction-wall-load',true) as application`);
                    request.settings = settings.rows[0];
                    if (settings.rows[0]?.statement !== "5s" || settings.rows[0]?.lock !== "3s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                    await savePickInTx(tx, { ...base, userId: request.userId, requestId: request.id });
                  });
                  request.result = "unexpected_success";
                } catch (error) { request.result = error instanceof Error && /截止/.test(error.message) ? "expected_cutoff" : failureClass(error); }
                finally { const end = performance.now(); request.totalMs = end - at; if (began !== undefined) request.transactionMs = end - began; }
              });
              const until = Date.now() + 800;
              while (Date.now() < until) {
                const sample = await monitor.query("select clock_timestamp() as now, count(*)::int as count from pg_stat_activity where application_name = 'prediction-wall-load' and wait_event_type = 'Lock'").catch(error => { samplingFailure = failureClass(error); return null; });
                if (!sample) break;
                waiting = sample.rows[0].count; before = new Date(sample.rows[0].now);
                if (waiting >= Math.min(concurrency, 5)) break;
                await new Promise(resolve => setTimeout(resolve, 10));
              }
              release(); await holder; await Promise.all(tasks); elapsedMs = performance.now() - start;
              const stored = await f.db.select().from(schema.predictionPicks);
              const outcomes = requests.map(request => ({ ...request, id: undefined, userId: undefined, observedCommitted: stored.some(row => row.requestId === request.id) }));
              const unexpected = !!samplingFailure || !before || before >= deadline || !after || after <= deadline || waiting < Math.min(concurrency, 5) || outcomes.some(item => item.result !== "expected_cutoff" || item.observedCommitted) || stored.length !== 1;
              stop = unexpected || maxQueue >= 8;
              if (stop) report.stopped = unexpected ? "unexpected_or_sampling_failure" : "sampled_pool_queue";
              report.rounds.push({ concurrency, round, deadline, before, after, observedLockWaiters: waiting, elapsedMs, requestsPerSecond: concurrency / (elapsedMs / 1000), maxPoolQueueSampled: maxQueue, outcomes, controlCommitted: stored.length === 1, samplingFailure, timingIncludesArtificialBarrier: true });
              recorded = true;
            } catch (error) {
              if (!samplingFailure || recorded) throw error;
              release(); await holder.catch(() => undefined); await Promise.allSettled(tasks);
              let stored: Array<{ requestId: string }> | undefined; let readbackFailure: string | undefined;
              try { stored = await f.db.select({ requestId: schema.predictionPicks.requestId }).from(schema.predictionPicks); }
              catch (readError) { readbackFailure = failureClass(readError); }
              stop = true; report.stopped = "unexpected_or_sampling_failure";
              report.rounds.push({ concurrency, round, samplingFailure, operationFailure: failureClass(error), readbackFailure, outcomes: requests.map(request => ({ ...request, id: undefined, userId: undefined, observedCommitted: stored?.some(row => row.requestId === request.id) ?? null })) });
            } finally { release(); clearInterval(sampler); await holder.catch(() => undefined); await Promise.allSettled(tasks); }
          } finally { await monitor.end(); }
        }, 24);
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally { if (process.env.RIVALHUB_PREDICTION_CAPACITY_REPORT) writeFileSync(process.env.RIVALHUB_PREDICTION_CAPACITY_REPORT, JSON.stringify(report, null, 2)); }
  expect(report.stopped).not.toBe("unexpected_or_sampling_failure");
}, 180000);
