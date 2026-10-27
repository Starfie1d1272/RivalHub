import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { balanceOf, savePickInTx } from "@/lib/predictions/service";
import { predictionCapacityFixture } from "./prediction-fixture";

it.skipIf(process.env.RIVALHUB_PREDICTION_CAPACITY !== "1")("measures isolated prediction drafts before and after cutoff", async () => {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(process.env.RIVALHUB_CAPACITY_SHA ?? "") || sha !== process.env.RIVALHUB_CAPACITY_SHA) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-capacity.test.ts"]);
  const paths = ["tests/integration/db/capacity/prediction-fixture.ts", "tests/integration/db/capacity/prediction-capacity.test.ts", "src/lib/predictions/service.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch database per round; one 24-team Major, two accounts, one PickEm contest, zero picks; alternating accounts, draft picks",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, sampledQueueStop: 8, stopOnAnyFailure: true }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await predictionCapacityFixture(async f => {
          f.pool.options.connectionTimeoutMillis = 2000;
          const [contest] = await f.db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, f.seasonId));
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
                  await savePickInTx(tx, { seasonId: f.seasonId, userId: request.userId, contestId: contest!.id, pick: { perfect: [], advance: [], eliminated: [] }, submitted: false, requestId: request.id });
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
            if (row) expect(row.accountId).toBe(accountFor(request.userId).id);
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
            await expect(f.db.transaction(tx => savePickInTx(tx, { seasonId: f.seasonId, userId: f.userId, contestId: contest!.id, pick: { perfect: [], advance: [], eliminated: [] }, submitted: false, requestId: randomUUID() }))).rejects.toThrow(/截止/);
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
