import { asc, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { predictionJobs } from "@/db/schema";
import { validateCronAuth } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/route";
import { captureException } from "@/lib/observability/server";
import {
  lockPredictionProgram,
  reconcilePredictionProgram,
} from "@/lib/predictions/service";
export async function GET(request: Request) {
  return withRouteObservability(
    request,
    "/api/cron/reconcile-predictions",
    async () => {
      const denied = validateCronAuth(request);
      if (denied) return denied;
      // Oldest first includes clean jobs for clock-driven locks and stage grants.
      const jobs = await db
        .select()
        .from(predictionJobs)
        .orderBy(desc(predictionJobs.dirty), asc(predictionJobs.updatedAt))
        .limit(10);
      let completed = 0,
        failed = 0;
      for (const job of jobs) {
        try {
          await db.transaction(async (tx) => {
            const program = await lockPredictionProgram(tx, job.seasonId);
            await reconcilePredictionProgram(tx, program);
          });
          completed++;
        } catch (e) {
          failed++;
          captureException("predictions.reconcile_failure", e, {
            scope: "predictions",
            operation: "reconcile",
            retryable: true,
          });
        }
      }
      return NextResponse.json(
        { ok: failed === 0, completed, failed },
        { status: failed ? 503 : 200 },
      );
    },
  );
}
