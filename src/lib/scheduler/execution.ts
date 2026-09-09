import "server-only";

import { NextResponse } from "next/server";
import { captureException, logEvent } from "@/lib/observability/server";
import {
  getSchedulerJobDefinition,
  getSchedulerRoute,
  isSchedulerSource,
  type SchedulerJobKey,
  type SchedulerSource,
} from "./definitions";
import {
  markBusinessTransition,
  markEndpointStarted,
  markJobFailed,
  markJobSucceeded,
  readSchedulerHealth,
} from "./health";

export interface SchedulerRunnerResult<T> {
  result: T;
  /** Number of committed domain facts changed by this run. */
  businessTransitions: number;
}

export interface SchedulerExecutionResult<T> {
  source: SchedulerSource;
  skipped: boolean;
  skipReason?: "primary_fresh";
  result?: T;
  businessTransitions: number;
}

export async function executeScheduledJob<T>(
  request: Request,
  jobKey: SchedulerJobKey,
  runner: () => Promise<SchedulerRunnerResult<T>>,
): Promise<SchedulerExecutionResult<T> | Response> {
  const source = parseSchedulerSource(request);
  if (source instanceof Response) return source;

  return executeScheduledJobCore({ jobKey, source, runner });
}

/** Shared runner used by the super-admin break-glass action. */
export async function executeScheduledJobManually<T>(
  jobKey: SchedulerJobKey,
  runner: () => Promise<SchedulerRunnerResult<T>>,
): Promise<SchedulerExecutionResult<T>> {
  return executeScheduledJobCore({ jobKey, source: "super-admin-manual", runner });
}

async function executeScheduledJobCore<T>(input: {
  jobKey: SchedulerJobKey;
  source: SchedulerSource;
  runner: () => Promise<SchedulerRunnerResult<T>>;
}): Promise<SchedulerExecutionResult<T>> {
  const definition = getSchedulerJobDefinition(input.jobKey);
  if (!definition) {
    // This is a programmer/configuration invariant, not an untrusted request
    // error. The public route never reaches this branch with a typed key.
    throw new Error("Unknown scheduler job definition");
  }

  const now = new Date();
  if (input.source === "github-watchdog") {
    const health = await readSchedulerHealth(input.jobKey);
    if (health?.lastPrimaryTriggeredAt && isFresh(health.lastPrimaryTriggeredAt, definition.staleAfterMs, now)) {
      await markJobSucceeded(input.jobKey, input.source, now);
      logEvent({
        level: "info",
        event: "scheduler.watchdog.noop",
        scope: "scheduler",
        operation: "watchdog",
        safeContext: { jobKey: input.jobKey, source: input.source, outcome: "primary_fresh" },
      });
      return {
        source: input.source,
        skipped: true,
        skipReason: "primary_fresh",
        businessTransitions: 0,
      };
    }
  }

  await markEndpointStarted(input.jobKey, input.source, now);
  try {
    const run = await input.runner();
    const businessTransitions = normalizeTransitionCount(run.businessTransitions);
    await markJobSucceeded(input.jobKey, input.source, new Date());
    await markBusinessTransition(input.jobKey, businessTransitions, new Date());
    logEvent({
      level: "info",
      event: "scheduler.job.succeeded",
      scope: "scheduler",
      operation: "job.execute",
      safeContext: {
        jobKey: input.jobKey,
        source: input.source,
        outcome: "success",
        count: businessTransitions,
      },
    });
    return {
      source: input.source,
      skipped: false,
      result: run.result,
      businessTransitions,
    };
  } catch (error) {
    await markJobFailed(input.jobKey, input.source, error, new Date());
    captureException("scheduler.job.failure", error, {
      scope: "scheduler",
      operation: "job.execute",
      route: getSchedulerRoute(definition),
      safeContext: { jobKey: input.jobKey, source: input.source },
    });
    throw error;
  }
}

function parseSchedulerSource(request: Request): SchedulerSource | Response {
  const value = request.headers.get("x-rivalhub-cron-source");
  if (value === null || value.trim() === "") return "legacy";
  const source = value.trim();
  if (isSchedulerSource(source)) return source;
  return NextResponse.json({ error: "Invalid scheduler source" }, { status: 400 });
}

export function isFresh(lastTriggeredAt: Date, staleAfterMs: number, now = new Date()): boolean {
  const age = now.getTime() - lastTriggeredAt.getTime();
  return age >= 0 && age <= staleAfterMs;
}

function normalizeTransitionCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
