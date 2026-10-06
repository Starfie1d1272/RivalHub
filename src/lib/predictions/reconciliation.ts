import "server-only";
import { runBetReconciliationJob } from "@/lib/bet/service";
import { asc, desc, sql } from "drizzle-orm";
import { db, type DB } from "@/db/client";
import { predictionJobs } from "@/db/schema";
import { captureException } from "@/lib/observability/server";
import { lockPredictionProgram, reconcilePredictionProgram } from "./service";

export async function runPredictionReconciliationJob(database: DB = db) {
  const jobs = await database
    .select()
    .from(predictionJobs)
    .where(sql`public.prediction_reconciliation_is_due(${predictionJobs.seasonId})`)
    .orderBy(desc(predictionJobs.dirty), asc(predictionJobs.updatedAt))
    .limit(10);
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await database.transaction(async (tx) => {
        const program = await lockPredictionProgram(tx, job.seasonId);
        await reconcilePredictionProgram(tx, program);
      });
      completed++;
    } catch (error) {
      failed++;
      captureException("predictions.reconcile_failure", error, {
        scope: "predictions",
        operation: "reconcile",
        retryable: true,
      });
    }
  }
  // Partial failure must reach scheduler health; individual committed programs stay idempotent.
  if (failed)
    throw new Error(`Prediction reconciliation failed for ${failed} programs`);
  const betCompleted = await runBetReconciliationJob(database);
  return { result: { completed, betCompleted }, businessTransitions: 0 };
}
