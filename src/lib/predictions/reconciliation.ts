import "server-only";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { predictionJobs } from "@/db/schema";
import { captureException } from "@/lib/observability/server";
import { lockPredictionProgram, reconcilePredictionProgram } from "./service";

export async function runPredictionReconciliationJob() {
  const jobs = await db
    .select()
    .from(predictionJobs)
    .orderBy(desc(predictionJobs.dirty), asc(predictionJobs.updatedAt))
    .limit(10);
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await db.transaction(async (tx) => {
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
  return { result: { completed }, businessTransitions: 0 };
}
