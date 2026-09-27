import type { SchedulerJobDefinition } from "./definitions";

export interface PrimaryHealthFacts {
  lastPrimaryTriggeredAt: Date | null;
  lastPrimaryDispatchRequestedAt: Date | null;
  lastPrimaryEndpointSucceededAt: Date | null;
}

function isFresh(lastAt: Date, staleAfterMs: number, now: Date): boolean {
  const age = now.getTime() - lastAt.getTime();
  return age >= 0 && age <= staleAfterMs;
}

/**
 * A healthy primary scheduler is checking on cadence and has no unconsumed
 * dispatch. Idle time is healthy: endpoint freshness matters only after a
 * dispatch was actually requested.
 */
export function isPrimaryHealthHealthy(
  record: PrimaryHealthFacts | null | undefined,
  definition: Pick<SchedulerJobDefinition, "staleAfterMs">,
  now = new Date(),
): boolean {
  if (!record?.lastPrimaryTriggeredAt || !isFresh(record.lastPrimaryTriggeredAt, definition.staleAfterMs, now)) {
    return false;
  }
  if (!record.lastPrimaryDispatchRequestedAt) return true;
  return Boolean(
    record.lastPrimaryEndpointSucceededAt &&
    record.lastPrimaryEndpointSucceededAt.getTime() >= record.lastPrimaryDispatchRequestedAt.getTime(),
  );
}
