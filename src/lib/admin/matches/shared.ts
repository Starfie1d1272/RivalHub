import type { Match, MatchMap } from "@/db/schema";
import type {
  AdminCompletedMap,
  AdminFinishedMap,
  AdminMatchMapRecord,
  AdminMatchSummary,
  AdminPendingMap,
} from "@/lib/admin/matches/types";
import type { StagePlan } from "@/types/season";

const STATUS_SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  scheduled: 1,
  finished: 2,
  cancelled: 3,
};

export function projectAdminMatchSummary(match: Match): AdminMatchSummary {
  return {
    id: match.id,
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    stage: match.stage,
    round: match.round,
    format: match.format,
    entryRound: match.entryRound,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    status: match.status,
    isForfeit: match.isForfeit,
    ownership: match.ownership,
    scheduledAt: match.scheduledAt,
  };
}

export function sortAdminMatches<T extends Pick<Match, "status" | "scheduledAt" | "completedAt">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const diff = (STATUS_SORT_ORDER[a.status] ?? 9) - (STATUS_SORT_ORDER[b.status] ?? 9);
    if (diff !== 0) return diff;
    if (a.status === "scheduled" || a.status === "in_progress") {
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    }
    if (a.status === "finished") {
      if (!a.completedAt && !b.completedAt) return 0;
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return b.completedAt.getTime() - a.completedAt.getTime();
    }
    return 0;
  });
}

export function mapCompletedMaps(records: readonly AdminMatchMapRecord[]): AdminCompletedMap[] {
  return records
    .filter((record) => record.scoreA !== null && record.scoreB !== null)
    .map((record) => ({
      mapOrder: record.mapOrder,
      mapName: record.mapName,
      scoreA: record.scoreA as number,
      scoreB: record.scoreB as number,
      pickedByEntryId: record.pickedByEntryId,
      teamAStartSide: record.teamAStartSide,
    }));
}

export function mapPendingMaps(records: readonly AdminMatchMapRecord[]): AdminPendingMap[] {
  return records
    .filter((record) => record.scoreA === null && record.scoreB === null)
    .map((record) => ({
      mapOrder: record.mapOrder,
      mapName: record.mapName,
      pickedByEntryId: record.pickedByEntryId,
      teamAStartSide: record.teamAStartSide,
    }));
}

export function mapFinishedMaps(records: readonly Pick<MatchMap, "id" | "mapName" | "scoreA" | "scoreB">[]): AdminFinishedMap[] {
  return records
    .filter((record) => record.scoreA !== null && record.scoreB !== null)
    .map((record) => ({
      id: record.id,
      mapName: record.mapName,
      scoreA: record.scoreA as number,
      scoreB: record.scoreB as number,
    }));
}

export function buildBatchDeadlineGroups(
  matches: readonly Pick<Match, "status" | "stage" | "round" | "entryRound">[],
  stagePlan: StagePlan,
): { label: string; stage: string; round?: number | null; entryRound?: string | null; matchCount: number }[] {
  const groupMap = new Map<string, { label: string; stage: string; round?: number | null; entryRound?: string | null; matchCount: number }>();
  for (const match of matches) {
    if (match.status !== "scheduled" && match.status !== "in_progress") continue;
    const stageName = stagePlan.find((stage) => stage.key === match.stage)?.name ?? match.stage;
    let key: string;
    let label: string;
    if (match.round != null) {
      key = `${match.stage}:round:${match.round}`;
      label = `${stageName} · 第 ${match.round} 轮`;
    } else if (match.entryRound) {
      key = `${match.stage}:entry:${match.entryRound}`;
      label = `${stageName} · ${match.entryRound}`;
    } else {
      key = `${match.stage}:all`;
      label = stageName;
    }
    const existing = groupMap.get(key);
    if (existing) {
      existing.matchCount += 1;
    } else {
      groupMap.set(key, {
        label,
        stage: match.stage,
        round: match.round,
        entryRound: match.entryRound,
        matchCount: 1,
      });
    }
  }
  return [...groupMap.values()];
}
