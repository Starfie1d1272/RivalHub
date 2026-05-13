"use client";

import { useMemo, useState } from "react";
import type { DraftPlayerRow } from "@/lib/draft/data";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { MapPreferenceChips } from "@/components/rivalhub/map-preference-chips";

interface PlayerPoolProps {
  players: DraftPlayerRow[];
  seasonPositions: string[];
}

export function PlayerPool({ players, seasonPositions }: PlayerPoolProps) {
  const [filter, setFilter] = useState<string>("all");

  const grouped = useMemo(() => {
    const map = new Map<string, DraftPlayerRow[]>();
    for (const p of players) {
      const list = map.get(p.primaryPosition) ?? [];
      list.push(p);
      map.set(p.primaryPosition, list);
    }
    return map;
  }, [players]);

  const positionOptions = useMemo(() => {
    const ordered = [...seasonPositions];
    for (const position of grouped.keys()) {
      if (!ordered.includes(position)) ordered.push(position);
    }
    return ordered;
  }, [grouped, seasonPositions]);

  const positions: readonly string[] =
    filter === "all"
      ? positionOptions
      : positionOptions.filter((position) => position === filter);

  const total = players.length;

  if (total === 0) {
    return (
      <div className="py-12 text-center text-[var(--color-fg-dim)] text-sm">
        所有选手已被选完
      </div>
    );
  }

  return (
    <div>
      {/* 筛选栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            filter === "all"
              ? "bg-[var(--color-accent)] text-white"
              : "bg-[var(--color-panel-hi)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
          }`}
        >
          全部 ({total})
        </button>
        {positionOptions.map((pos) => {
          const count = grouped.get(pos)?.length ?? 0;
          return (
            <button
              key={pos}
              onClick={() => setFilter(pos === filter ? "all" : pos)}
              disabled={count === 0}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                pos === filter
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-panel-hi)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] disabled:opacity-30"
              }`}
            >
              {POSITION_LABELS[pos as keyof typeof POSITION_LABELS]?.en ?? pos} ({count})
            </button>
          );
        })}
      </div>

      {/* 选手列表 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
        {positions.flatMap((pos) => {
          const list = grouped.get(pos) ?? [];
          return list.map((p) => (
            <div
              key={p.registrationId}
              className="space-y-1.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)] px-2 py-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-fg)] truncate">
                  {p.steamName}
                </span>
                <span className="text-[var(--color-fg-dim)] tabular ml-1 shrink-0">
                  {p.peakRank} {p.peakRating.toFixed(2)}
                </span>
              </div>
              <MapPreferenceChips preferences={p.mapPreferences} compact minLevel="playable" />
            </div>
          ));
        })}
      </div>
    </div>
  );
}
