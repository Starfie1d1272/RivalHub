import type { ScoreboardCommand, ScoreboardOperation } from "./scoreboard-contract";

export interface PendingScoreboardOperation extends ScoreboardCommand {
  mapId: string;
  actorScope: string;
  operation: ScoreboardOperation;
}
const prefix = (mapId: string) => `rivalhub:scoreboard-operation:v1:${mapId}:`;
const key = (mapId: string, actorScope: string, operationId: string) => `${prefix(mapId)}${actorScope}:${operationId}`;
/** Only an operation locator is persisted; never an image, draft or credential. */
export function rememberScoreboardOperation(input: PendingScoreboardOperation): void {
  localStorage.setItem(key(input.mapId, input.actorScope, input.operationId), JSON.stringify({ mapId: input.mapId, actorScope: input.actorScope,
    operationId: input.operationId, expectedVersion: input.expectedVersion, operation: input.operation }));
}
export function readPendingScoreboardOperation(mapId: string, actorScope?: string): PendingScoreboardOperation | null {
  try {
    const scopePrefix = actorScope ? `${prefix(mapId)}${actorScope}:` : prefix(mapId);
    const storageKey = Object.keys(localStorage).find(item => item.startsWith(scopePrefix));
    if (!storageKey) return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw || raw.length > 1024) return null;
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object") return null;
    const item = input as Record<string, unknown>;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (item.mapId !== mapId || typeof item.actorScope !== "string" || !uuid.test(item.actorScope)
      || typeof item.operationId !== "string" || !uuid.test(item.operationId)
      || typeof item.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(item.expectedVersion)
      || (item.operation !== "save" && item.operation !== "clear")) return null;
    return { mapId, actorScope: item.actorScope, operationId: item.operationId, expectedVersion: item.expectedVersion, operation: item.operation };
  } catch { return null; }
}
export function forgetScoreboardOperation(mapId: string, actorScope: string, operationId: string): void {
  try { localStorage.removeItem(key(mapId, actorScope, operationId)); } catch { /* Committed status is already known; storage is best effort on cleanup. */ }
}
