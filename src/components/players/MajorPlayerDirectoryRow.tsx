import React from "react";
import Link from "next/link";

import { Panel } from "@/components/rivalhub";
import { DirectoryMetric } from "@/components/players/DirectoryMetric";
import type { MajorPublicParticipantPlayer } from "@/lib/major/public-participants";
import { formatStat } from "@/lib/stats";

export function MajorPlayerDirectoryRow({
  player,
  seasonSlug,
}: {
  player: MajorPublicParticipantPlayer;
  seasonSlug: string;
}) {
  return (
    <Panel hoverable contentClassName="p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/players/${player.userId}`}
              className="truncate text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors sm:text-base"
            >
              {player.name}
            </Link>
            <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-mid)]">
              {player.isStarter ? "首发" : "替补"}
            </span>
            {player.isRepresentative && (
              <span className="border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-mid)]">
                队伍代表
              </span>
            )}
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
            暂无本届已验证数据
          </div>
        )}
      </div>
    </Panel>
  );
}
