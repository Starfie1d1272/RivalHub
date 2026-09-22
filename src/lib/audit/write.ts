import "server-only";

import type { TxDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { AUDIT_EVENT_REGISTRY, type AuditAction } from "./presentation";

export interface AuditWriteEvent<Action extends AuditAction = AuditAction> {
  action: Action;
  actorId: string;
  targetId: string;
  seasonId?: string | null;
  meta?: Record<string, unknown> | null;
}

type AuditWriteExecutor = Pick<TxDb, "insert">;

/**
 * The only normal write boundary for immutable audit facts. Call it with the
 * transaction that owns the business mutation so the audit fact commits or
 * rolls back atomically with that mutation.
 */
export async function writeAuditInTx(
  tx: AuditWriteExecutor,
  event: AuditWriteEvent | readonly AuditWriteEvent[],
): Promise<void> {
  if (isAuditWriteEventBatch(event)) {
    await tx.insert(auditLogs).values(event.map(toAuditLogValue));
    return;
  }

  await tx.insert(auditLogs).values(toAuditLogValue(event));
}

function isAuditWriteEventBatch(
  event: AuditWriteEvent | readonly AuditWriteEvent[],
): event is readonly AuditWriteEvent[] {
  return Array.isArray(event);
}

function toAuditLogValue(event: AuditWriteEvent) {
  return {
    seasonId: event.seasonId ?? null,
    action: event.action,
    actorId: event.actorId,
    targetId: event.targetId,
    targetType: AUDIT_EVENT_REGISTRY[event.action].target.type,
    meta: event.meta ?? null,
  };
}
