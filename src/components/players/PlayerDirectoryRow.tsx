import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";
import { Panel, PosChip } from "@/components/rivalhub";
import { DirectoryMetric } from "@/components/players/DirectoryMetric";
import { positionLabel } from "@/lib/validators/registration";
import { formatStat } from "@/lib/stats";

export interface PlayerDirectoryData {
  userId: string;
  registrationId: string;
  avatarUrl?: string | null;
  displayName: string;
  primaryPosition: string;
  secondaryPosition: string | null;
  peakRank: string;
  peakRating: number;
  currentRank: string;
  currentRating: number;
  teamName: string | null;
  teamId?: string | null;
  stats: {
    maps: number;
    avgRating: number | null;
    avgAdr: number | null;
    avgKd: number | null;
  } | null;
}

export function PlayerDirectoryRow({ player, seasonSlug }: { player: PlayerDirectoryData; seasonSlug?: string }) {
  return (
    <Panel hoverable contentClassName="p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <PlayerAvatar name={player.displayName} avatarUrl={player.avatarUrl} size="sm" />
            <Link
              href={`/players/${player.userId}`}
              className="truncate text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors sm:text-base"
            >
              {player.displayName}
            </Link>
            <PosChip pos={positionLabel(player.primaryPosition)} />
            {player.secondaryPosition && (
              <span className="text-[11px] text-[var(--color-fg-dim)]">
                副位置 {positionLabel(player.secondaryPosition)}
              </span>
            )}
            <span className="text-xs text-[var(--color-fg-mid)]">
              {player.teamId && seasonSlug ? <Link href={`/${seasonSlug}/teams/${player.teamId}`}>{player.teamName}</Link> : player.teamName ?? "待分配队伍"}
            </span>
          </div>
        </div>

        {player.stats ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-2 lg:justify-end lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <DirectoryMetric label="地图" value={player.stats.maps} />
            <DirectoryMetric label="Rating" value={formatStat("ratingPro", player.stats.avgRating)} />
            <DirectoryMetric label="ADR" value={formatStat("adr", player.stats.avgAdr)} />
            <DirectoryMetric label="K/D" value={formatStat("kd", player.stats.avgKd)} />
          </div>
        ) : (
          <div className="border-t border-[var(--color-border)] pt-2 text-xs uppercase text-[var(--color-fg-dim)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 lg:text-right" style={{ fontFamily: "var(--font-mono)" }}>
            暂无正式比赛数据
          </div>
        )}
      </div>
    </Panel>
  );
}
