"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCST } from "@/lib/utils/date";
import { MATCH_STATUS_LABELS } from "@/types/match";
import type { MatchStatus } from "@/types/match";

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  finished: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelled: "bg-[var(--color-fg-dim)]/10 text-[var(--color-fg-dim)] border-[var(--color-border)]",
};

const FORMAT_LABELS: Record<string, string> = {
  bo1: "BO1",
  bo3: "BO3",
  bo5: "BO5",
};

const STAGE_LABELS: Record<string, string> = {
  qualifier: "排位赛",
  playoff: "正赛",
};

const SIDE_LABELS: Record<string, string> = {
  t: "T",
  ct: "CT",
};

export interface MatchMapData {
  mapOrder: number;
  mapName: string;
  pickedByTeamName: string | null;
  teamAStartSide: string | null;
  scoreA: number | null;
  scoreB: number | null;
}

export interface MatchDetailData {
  id: string;
  teamAName: string;
  teamAId: string;
  teamBName: string;
  teamBId: string;
  format: string;
  stage: string;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  maps: MatchMapData[];
  seasonSlug: string;
}

export function MatchDetail({ match }: { match: MatchDetailData }) {
  const isFinished = match.status === "finished";
  const hasScore = match.scoreA !== null && match.scoreB !== null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${match.seasonSlug}/matches`}
          className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← 赛程总览
        </Link>
      </div>

      {/* 比赛头部 */}
      <Card className="bg-[var(--color-panel)] border-[var(--color-border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`text-xs ${STATUS_STYLES[match.status] ?? ""}`}>
              {MATCH_STATUS_LABELS[match.status as MatchStatus] ?? match.status}
            </Badge>
            <Badge variant="outline" className="text-xs border-[var(--color-border)] text-[var(--color-fg-mid)]">
              {FORMAT_LABELS[match.format] ?? match.format}
            </Badge>
            <Badge variant="outline" className="text-xs border-[var(--color-border)] text-[var(--color-fg-mid)]">
              {STAGE_LABELS[match.stage] ?? match.stage}
            </Badge>
          </div>
          {match.scheduledAt && !isFinished && (
            <p className="text-sm text-[var(--color-fg-dim)]">
              {formatCST(match.scheduledAt)}
            </p>
          )}
          {match.completedAt && isFinished && (
            <p className="text-sm text-[var(--color-fg-dim)]">
              {formatCST(match.completedAt)}
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-6">
          <Link href={`/${match.seasonSlug}/teams/${match.teamAId}`} className="text-right flex-1 hover:opacity-80 transition-opacity">
            <p className="text-xl font-bold text-[var(--color-fg)] truncate">{match.teamAName}</p>
          </Link>

          <div className="text-center shrink-0 px-4">
            {hasScore ? (
              <p className="text-4xl font-bold text-[var(--color-fg)] tabular-nums">
                {match.scoreA} <span className="text-[var(--color-fg-dim)]">:</span> {match.scoreB}
              </p>
            ) : (
              <p className="text-2xl font-bold text-[var(--color-fg-dim)]">VS</p>
            )}
          </div>

          <Link href={`/${match.seasonSlug}/teams/${match.teamBId}`} className="text-left flex-1 hover:opacity-80 transition-opacity">
            <p className="text-xl font-bold text-[var(--color-fg)] truncate">{match.teamBName}</p>
          </Link>
        </div>
      </Card>

      {/* 地图结果 */}
      {match.maps.length > 0 && (
        <Card className="bg-[var(--color-panel)] border-[var(--color-border)] overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] uppercase tracking-wide">
              地图结果
            </h2>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {match.maps.map((m) => (
              <MapRow key={m.mapOrder} map={m} teamAName={match.teamAName} teamBName={match.teamBName} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function MapRow({
  map,
  teamAName,
  teamBName,
}: {
  map: MatchMapData;
  teamAName: string;
  teamBName: string;
}) {
  const hasScore = map.scoreA !== null && map.scoreB !== null;

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="w-6 shrink-0 text-center text-xs text-[var(--color-fg-dim)] font-mono">
        G{map.mapOrder}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-[var(--color-fg)]">{map.mapName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {map.pickedByTeamName && (
            <span className="text-xs text-[var(--color-fg-dim)]">
              {map.pickedByTeamName} pick
            </span>
          )}
          {!map.pickedByTeamName && (
            <span className="text-xs text-[var(--color-fg-dim)]">决胜图</span>
          )}
          {map.teamAStartSide && (
            <span className="text-xs text-[var(--color-fg-dim)]">
              · {teamAName} 起始 {SIDE_LABELS[map.teamAStartSide]}
            </span>
          )}
        </div>
      </div>

      {hasScore && (
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums text-[var(--color-fg)]">
            {map.scoreA} : {map.scoreB}
          </p>
          {map.scoreA !== null && map.scoreB !== null && (
            <p className="text-xs text-[var(--color-fg-dim)]">
              {map.scoreA > map.scoreB ? teamAName : teamBName} 胜
            </p>
          )}
        </div>
      )}
    </div>
  );
}
