import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import type { PlayerHighlightStats } from "@/actions/season-demo-stats";

interface HighlightLeaderboardProps {
  highlights: PlayerHighlightStats[];
  seasonSlug: string;
}

function HighlightCard({
  label,
  description,
  icon,
  data,
  statKey,
  seasonSlug,
}: {
  label: string;
  description: string;
  icon: string;
  data: PlayerHighlightStats[];
  statKey: "collateralKills" | "wallbangKills" | "noScopeKills";
  seasonSlug: string;
}) {
  const sorted = [...data].sort((a, b) => b[statKey] - a[statKey]);
  const top = sorted.filter((p) => p[statKey] > 0).slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="font-bold text-base text-[var(--color-fg)]">{label}</div>
          <div className="text-xs text-[var(--color-fg-mid)]">{description}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {top.length === 0 && (
          <div className="text-xs text-[var(--color-fg-muted)] italic">暂无数据</div>
        )}
        {top.map((p, i) => (
          <div
            key={`${p.userId}-${statKey}`}
            className="flex items-center justify-between py-1 px-2 rounded
              bg-[var(--color-bg-subtle)]/50"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-xs font-mono w-5 text-right shrink-0
                  ${i === 0 ? "text-yellow-500" : "text-[var(--color-fg-mid)]"}`}
              >
                #{i + 1}
              </span>
              <Link
                href={`/${seasonSlug}/players/${p.userId}`}
                className="text-sm text-[var(--color-accent)] hover:underline truncate"
              >
                {p.perfectName}
              </Link>
            </div>
            <span className="text-sm font-bold font-mono tabular-nums shrink-0 ml-2">
              {p[statKey]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HighlightLeaderboard({
  highlights,
  seasonSlug,
}: HighlightLeaderboardProps) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">🏆 高光击杀榜</h2>
        <span className="text-xs text-[var(--color-fg-muted)]">
          基于 {highlights.reduce((s, p) => s + p.maps, 0)} 张 demo 地图
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <HighlightCard
          label="集火"
          description="一枪穿透击杀 ≥2 人"
          icon="💥"
          data={highlights}
          statKey="collateralKills"
          seasonSlug={seasonSlug}
        />
        <HighlightCard
          label="穿墙"
          description="穿墙击杀"
          icon="🧱"
          data={highlights}
          statKey="wallbangKills"
          seasonSlug={seasonSlug}
        />
        <HighlightCard
          label="盲狙"
          description="狙击未开镜击杀"
          icon="🎯"
          data={highlights}
          statKey="noScopeKills"
          seasonSlug={seasonSlug}
        />
      </div>
    </Panel>
  );
}
