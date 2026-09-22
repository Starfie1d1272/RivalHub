import "server-only";

import { createHash } from "node:crypto";

import type { Match, MatchMap } from "@/db/schema";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";

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

export function buildEvidenceRevisionForTarget(input: {
  match: Pick<Match, "id" | "seasonId" | "stage" | "majorStageRunId" | "status" | "entryAId" | "entryBId">;
  map: Pick<MatchMap, "id" | "mapOrder" | "mapName" | "scoreA" | "scoreB" | "completedAt">;
  roster: readonly Pick<EffectiveMatchRosterPlayer, "entryId" | "eventRosterMemberId" | "userId" | "steam64" | "isStarter">[];
}): string {
  return buildEvidenceRevision({
    seasonId: input.match.seasonId,
    stageKey: input.match.stage,
    stageRunId: input.match.majorStageRunId,
    matchId: input.match.id,
    matchMapId: input.map.id,
    mapOrder: input.map.mapOrder,
    mapName: input.map.mapName,
    mapScoreA: input.map.scoreA,
    mapScoreB: input.map.scoreB,
    mapCompletedAt: input.map.completedAt?.toISOString() ?? null,
    matchStatus: input.match.status,
    entryAId: input.match.entryAId,
    entryBId: input.match.entryBId,
    roster: input.roster.map((member) => ({
      entryId: member.entryId,
      eventRosterMemberId: member.eventRosterMemberId,
      userId: member.userId,
      steam64: member.steam64,
      isStarter: member.isStarter,
    })),
  });
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}
