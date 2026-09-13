import "server-only";

import { createHash } from "node:crypto";

export interface EvidenceRevisionRosterMember {
  entryId: string;
  eventRosterMemberId: string;
  userId: string;
  steam64: string | null;
  isStarter: boolean;
}

export interface EvidenceRevisionInput {
  seasonId: string;
  stageKey: string;
  stageRunId: string | null;
  matchId: string;
  matchMapId: string;
  mapOrder: number;
  mapName: string;
  mapScoreA: number | null;
  mapScoreB: number | null;
  mapCompletedAt: string | null;
  matchStatus: string;
  entryAId: string;
  entryBId: string;
  roster: readonly EvidenceRevisionRosterMember[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

/** Opaque server-owned snapshot of the exact target and active lineup facts. */
export function buildEvidenceRevision(input: EvidenceRevisionInput): string {
  const roster = [...input.roster]
    .map((member) => ({ ...member }))
    .sort((a, b) => a.entryId.localeCompare(b.entryId) || a.eventRosterMemberId.localeCompare(b.eventRosterMemberId));
  const payload = stableValue({ ...input, roster });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}
