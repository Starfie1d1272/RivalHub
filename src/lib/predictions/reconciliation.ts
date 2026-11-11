import "server-only";
import { runBetReconciliationJob } from "@/lib/bet/service";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, type DB } from "@/db/client";
import { predictionJobs } from "@/db/schema";
import { captureException } from "@/lib/observability/server";
import { lockPredictionProgram, reconcileDuePredictionProgram } from "./service";

export async function runPredictionReconciliationJob(database: DB = db) {
  const jobs = await database
    .select({
      seasonId: predictionJobs.seasonId,
      queueTime: sql<string>`${predictionJobs.updatedAt}::text`,
    })
    .from(predictionJobs)
    .where(sql`public.prediction_reconciliation_is_due(${predictionJobs.seasonId})`)
    .orderBy(asc(predictionJobs.updatedAt), asc(predictionJobs.seasonId))
    .limit(10);
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await database.transaction(async (tx) => {
        const program = await lockPredictionProgram(tx, job.seasonId);
        await reconcileDuePredictionProgram(tx, program);
      });
      completed++;
    } catch (error) {
      failed++;
      captureException("predictions.reconcile_failure", error, {
        scope: "predictions",
        operation: "reconcile",
        retryable: true,
      });
      await database
        .update(predictionJobs)
        .set({ updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(predictionJobs.seasonId, job.seasonId),
            sql`${predictionJobs.updatedAt} = ${job.queueTime}::timestamptz`,
          ),
        )
        .catch((error) =>
          captureException("predictions.reconcile_retry_order_failed", error, {
            scope: "predictions",
            operation: "reconcile",
            retryable: true,
          }),
        );
    }
  }
  const betCompleted = await runBetReconciliationJob(database);
  // Partial failure must reach scheduler health; individual committed programs stay idempotent.
  if (failed) throw new Error(`Prediction reconciliation failed for ${failed} programs`);
  return { result: { completed, betCompleted }, businessTransitions: 0 };
}
