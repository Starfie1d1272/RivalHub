import "server-only";

import { isPrimaryHealthy, readAllSchedulerHealth, type SchedulerHealthRecord } from "./health";
import { SCHEDULER_JOB_DEFINITIONS, type SchedulerJobKey } from "./definitions";

export interface SchedulerHealthView {
  jobKey: SchedulerJobKey;
  label: string;
  status: "normal" | "degraded";
  primaryTriggeredAt: string | null;
  endpointSucceededAt: string | null;
  businessTransitionAt: string | null;
  watchdogSucceededAt: string | null;
  manualSucceededAt: string | null;
  failureAt: string | null;
}

export async function getSchedulerHealthView(now = new Date()): Promise<SchedulerHealthView[]> {
  const records = await readAllSchedulerHealth();
  const byKey = new Map(records.map((record) => [record.jobKey, record]));
  return SCHEDULER_JOB_DEFINITIONS.map((definition) => {
    const record = byKey.get(definition.key);
    const primaryHealthy = isPrimaryHealthy(record, definition, now);
    return {
      jobKey: definition.key,
      label: definition.label,
      status: primaryHealthy ? "normal" : "degraded",
      primaryTriggeredAt: record?.lastPrimaryTriggeredAt?.toISOString() ?? null,
      endpointSucceededAt: record?.lastPrimaryEndpointSucceededAt?.toISOString() ?? null,
      businessTransitionAt: record?.lastBusinessTransitionAt?.toISOString() ?? null,
      watchdogSucceededAt: record?.lastWatchdogSucceededAt?.toISOString() ?? null,
      manualSucceededAt: record?.lastManualSucceededAt?.toISOString() ?? null,
      failureAt: record?.lastFailureAt?.toISOString() ?? null,
    };
  });
}

export type { SchedulerHealthRecord };
