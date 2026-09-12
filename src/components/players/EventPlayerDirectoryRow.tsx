import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { DirectoryMetric } from "@/components/players/DirectoryMetric";
import { formatStat } from "@/lib/stats";

export interface EventPlayerDirectoryRowData {
  userId: string;
  avatarUrl?: string | null;
  entryId: string;
  entryName: string;
  name: string;
  isStarter: boolean;
  isRepresentative?: boolean;
  stats: {
    maps: number;
    avgRating: number | null;
    avgAdr: number | null;
    avgKd: number | null;
  } | null;
}

export function EventPlayerDirectoryRow({
  player,
  seasonSlug,
}: {
  player: EventPlayerDirectoryRowData;
  seasonSlug: string;
}) {
  return (
    <Panel hoverable contentClassName="p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl} size="sm" />
            <Link
              href={`/players/${player.userId}`}
              className="truncate text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors sm:text-base"
            >
              {player.name}
            </Link>
            <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-mid)]">
              {player.isStarter ? "首发" : "替补"}
            </span>
          </div>
          <Link
            href={`/${seasonSlug}/teams/${player.entryId}`}
            className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)] transition-colors"
          >
            {player.entryName}
          </Link>
        </div>

        {player.stats ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-2 lg:justify-end lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <DirectoryMetric label="地图" value={player.stats.maps} />
            <DirectoryMetric label="Rating" value={formatStat("ratingPro", player.stats.avgRating)} />
            <DirectoryMetric label="ADR" value={formatStat("adr", player.stats.avgAdr)} />
            <DirectoryMetric label="K/D" value={formatStat("kd", player.stats.avgKd)} />
          </div>
        ) : (
          <div className="border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-fg-dim)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 lg:text-right">
            暂无本届正式比赛数据
          </div>
        )}
      </div>
    </Panel>
  );
}
