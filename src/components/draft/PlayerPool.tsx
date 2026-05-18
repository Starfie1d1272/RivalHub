"use client";

import React from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { DraftPlayerRow } from "@/lib/draft/data";
import { positionLabel } from "@/lib/validators/registration";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PosChip } from "@/components/rivalhub/PosChip";
import { PlayerInfoPopover } from "./PlayerInfoPopover";
import { getDisplayName } from "@/lib/utils/display-name";
import { sortByRank } from "@/lib/utils/rank";

const FILTER_ALL = "all";

interface PlayerPoolProps {
  players: DraftPlayerRow[];
  seasonPositions: string[];
}

export function PlayerPool({ players, seasonPositions }: PlayerPoolProps) {
  const [filter, setFilter] = useState<string>(FILTER_ALL);

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

  const sortedPlayers = useMemo(() => {
    const filtered =
      filter === FILTER_ALL
        ? players
        : players.filter((p) => p.primaryPosition === filter || p.secondaryPosition === filter);
    return sortByRank(filtered);
  }, [players, filter]);

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
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setFilter(FILTER_ALL)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            filter === FILTER_ALL
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
              onClick={() => setFilter(pos === filter ? FILTER_ALL : pos)}
              disabled={count === 0}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                pos === filter
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-panel-hi)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] disabled:opacity-30"
              }`}
            >
              {positionLabel(pos)} ({count})
            </button>
          );
        })}
      </div>

      {/* Unified sorted list */}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {sortedPlayers.map((p) => {
          const displayedName = getDisplayName(p);
          return (
            <div
              key={p.registrationId}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2"
            >
              {/* Desktop: single row */}
              <div className="hidden md:flex items-center gap-3">
                <span
                  className="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-fg)",
                    borderColor: "var(--color-border)",
                    background: "var(--color-panel-hi)",
                  }}
                >
                  {p.peakRank}
                </span>
                <Link
                  href={`/players/${p.userId}`}
                  className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                >
                  {displayedName}
                </Link>
                <PosChip pos={positionLabel(p.primaryPosition)} small />
                <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
                  副{positionLabel(p.secondaryPosition)}
                </span>
                <span
                  className="shrink-0 text-xs tabular-nums text-[var(--color-fg-mid)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {p.peakRating.toFixed(2)}
                </span>
                <div className="min-w-0 flex-1">
                  <MapPreferenceChips preferences={p.mapPreferences} compact minLevel="playable" />
                </div>
                <PlayerInfoPopover
                  gameplayStyle={p.gameplayStyle}
                  notes={p.notes}
                  competitionHistory={p.competitionHistory}
                />
              </div>

              {/* Mobile: two rows */}
              <div className="md:hidden space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-fg)",
                      borderColor: "var(--color-border)",
                      background: "var(--color-panel-hi)",
                    }}
                  >
                    {p.peakRank}
                  </span>
                  <Link
                    href={`/players/${p.userId}`}
                    className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  >
                    {displayedName}
                  </Link>
                  <PosChip pos={positionLabel(p.primaryPosition)} small />
                  <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
                    副{positionLabel(p.secondaryPosition)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 text-xs tabular-nums text-[var(--color-fg-mid)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {p.peakRating.toFixed(2)}
                  </span>
                  <div className="min-w-0">
                    <MapPreferenceChips preferences={p.mapPreferences} compact minLevel="playable" />
                  </div>
                  <PlayerInfoPopover
                    gameplayStyle={p.gameplayStyle}
                    notes={p.notes}
                    competitionHistory={p.competitionHistory}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
