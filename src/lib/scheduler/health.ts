import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduledJobHealth } from "@/db/schema";
import { classifyError } from "@/lib/observability/errors";
import { captureException } from "@/lib/observability/server";
import type { SchedulerJobDefinition, SchedulerJobKey, SchedulerSource } from "./definitions";

export type SchedulerHealthRecord = typeof scheduledJobHealth.$inferSelect;

function isFresh(lastAt: Date, staleAfterMs: number, now = new Date()): boolean {
  const age = now.getTime() - lastAt.getTime();
  return age >= 0 && age <= staleAfterMs;
}

/** Primary is healthy only after both dispatch and endpoint execution are fresh. */
export function isPrimaryHealthy(
  record: Pick<SchedulerHealthRecord, "lastPrimaryTriggeredAt" | "lastPrimaryEndpointSucceededAt"> | null | undefined,
  definition: Pick<SchedulerJobDefinition, "staleAfterMs">,
  now = new Date(),
): boolean {
  return Boolean(
    record?.lastPrimaryTriggeredAt &&
    record.lastPrimaryEndpointSucceededAt &&
    isFresh(record.lastPrimaryTriggeredAt, definition.staleAfterMs, now) &&
    isFresh(record.lastPrimaryEndpointSucceededAt, definition.staleAfterMs, now),
  );
}

const databaseConfigured = (): boolean => Boolean(process.env.DATABASE_URL?.trim());

/**
 * Health is intentionally best effort. A missing/temporarily unavailable
 * health table must never turn a canonical business cron into a second failure.
 */
export async function readSchedulerHealth(jobKey: SchedulerJobKey): Promise<SchedulerHealthRecord | null> {
  if (!databaseConfigured()) return null;
  try {
    return await db.query.scheduledJobHealth.findFirst({ where: eq(scheduledJobHealth.jobKey, jobKey) }) ?? null;
  } catch (error) {
    recordHealthStorageFailure("read", jobKey, error);
    return null;
  }
}

export async function readAllSchedulerHealth(): Promise<SchedulerHealthRecord[]> {
  if (!databaseConfigured()) return [];
  try {
    return await db.select().from(scheduledJobHealth);
  } catch (error) {
    recordHealthStorageFailure("read_all", "scheduler", error);
    return [];
  }
}

export async function markEndpointStarted(
  jobKey: SchedulerJobKey,
  source: SchedulerSource,
  at = new Date(),
): Promise<void> {
  if (source !== "supabase-primary") return;
  await updateHealth(jobKey, { lastPrimaryEndpointStartedAt: at, updatedAt: at }, "endpoint_start");
}

export async function markJobSucceeded(
  jobKey: SchedulerJobKey,
  source: SchedulerSource,
  at = new Date(),
): Promise<void> {
  const values = {
    updatedAt: at,
    ...(source === "supabase-primary" ? { lastPrimaryEndpointSucceededAt: at } : {}),
    ...(source === "github-watchdog" ? { lastWatchdogSucceededAt: at } : {}),
    ...(["github-manual", "super-admin-manual"].includes(source) ? { lastManualSucceededAt: at } : {}),
  };
  await updateHealth(jobKey, values, "job_success");
}

export async function markBusinessTransition(
  jobKey: SchedulerJobKey,
  transitionCount: number,
  at = new Date(),
): Promise<void> {
  if (!Number.isFinite(transitionCount) || transitionCount <= 0) return;
  await updateHealth(jobKey, { lastBusinessTransitionAt: at, updatedAt: at }, "business_transition");
}

export async function markJobFailed(
  jobKey: SchedulerJobKey,
  source: SchedulerSource,
  error: unknown,
  at = new Date(),
): Promise<void> {
  const classification = classifyError(error);
  await updateHealth(jobKey, {
    lastFailureAt: at,
    lastFailureSource: source,
    lastFailureCode: classification.errorCode ?? classification.errorClass,
    updatedAt: at,
  }, "job_failure");
}

async function updateHealth(
  jobKey: SchedulerJobKey,
  values: Partial<typeof scheduledJobHealth.$inferInsert>,
  operation: string,
): Promise<void> {
  if (!databaseConfigured()) return;
  try {
    await db
      .insert(scheduledJobHealth)
      .values({ jobKey, ...values })
      .onConflictDoUpdate({
        target: scheduledJobHealth.jobKey,
        set: values,
      });
  } catch (error) {
    recordHealthStorageFailure(operation, jobKey, error);
  }
}

function recordHealthStorageFailure(operation: string, jobKey: string, error: unknown): void {
  captureException("scheduler.health_projection.failure", error, {
    scope: "scheduler",
    operation: `health.${operation}`,
    errorClass: "database",
    retryable: true,
    safeContext: { jobKey },
  });
}
