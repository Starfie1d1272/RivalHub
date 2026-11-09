"use client";

import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { useMemo, useState } from "react";
import type { PublicDraftPlayer } from "@/lib/draft/data";
import { positionLabel } from "@/lib/validators/registration";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PosChip } from "@/components/rivalhub/PosChip";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { sortByRank } from "@/lib/utils/rank";

const FILTER_ALL = "all";

interface PlayerPoolProps {
  players: PublicDraftPlayer[];
  seasonPositions: string[];
}

export function PlayerPool({ players, seasonPositions }: PlayerPoolProps) {
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicDraftPlayer[]>();
    for (const player of players) {
      for (const position of new Set([player.primaryPosition, player.secondaryPosition])) {
        if (!position) continue;
        const list = map.get(position) ?? [];
        list.push(player);
        map.set(position, list);
      }
    }
    return map;
  }, [players]);

  const positionOptions = useMemo(() => {
    const ordered = [...seasonPositions];
    for (const position of grouped.keys()) {
      if (!ordered.includes(position)) ordered.push(position);
    }
    if (filter !== FILTER_ALL && !ordered.includes(filter)) ordered.push(filter);
    return ordered;
  }, [filter, grouped, seasonPositions]);

  const sortedPlayers = useMemo(() => {
    const filtered = filter === FILTER_ALL ? players : (grouped.get(filter) ?? []);
    return sortByRank(filtered);
  }, [players, grouped, filter]);

  const total = players.length;

  if (total === 0) {
    return (
      <p role="status" className="py-12 text-center text-[var(--color-fg-dim)] text-sm">
        当前没有待选选手
      </p>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          aria-pressed={filter === FILTER_ALL}
          onClick={() => setFilter(FILTER_ALL)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            filter === FILTER_ALL
              ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
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
              type="button"
              aria-pressed={pos === filter}
              onClick={() => setFilter(pos === filter ? FILTER_ALL : pos)}
              disabled={count === 0 && pos !== filter}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                pos === filter
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                  : "bg-[var(--color-panel-hi)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] disabled:opacity-30"
              }`}
            >
              {positionLabel(pos)} ({count})
            </button>
          );
        })}
      </div>

      <p
        role="status"
        className={
          sortedPlayers.length > 0 ? "sr-only" : "py-8 text-center text-sm text-[var(--color-fg-dim)]"
        }
      >
        {sortedPlayers.length > 0 ? `${sortedPlayers.length} 位待选选手` : "当前筛选下没有待选选手"}
      </p>
      {/* Unified sorted list */}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {sortedPlayers.map((p) => {
          const displayedName = getPublicDisplayName(p);
          return (
            <div
              key={p.userId}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2"
            >
              {/* Desktop: single row */}
              <div className="hidden md:flex items-center gap-3">
                <PlayerAvatar
                  name={displayedName}
                  avatarUrl={p.avatarUrl}
                  hasActivePublicSanction={p.hasActivePublicSanction}
                  size="sm"
                />
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
                <PlayerProfileLink
                  userId={p.userId}
                  className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                >
                  {displayedName}
                </PlayerProfileLink>
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
              </div>

              {/* Mobile: two rows */}
              <div className="md:hidden space-y-1">
                <div className="flex items-center gap-2">
                  <PlayerAvatar
                    name={displayedName}
                    avatarUrl={p.avatarUrl}
                    hasActivePublicSanction={p.hasActivePublicSanction}
                    size="sm"
                  />
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
                  <PlayerProfileLink
                    userId={p.userId}
                    className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  >
                    {displayedName}
                  </PlayerProfileLink>
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
                    <MapPreferenceChips
                      preferences={p.mapPreferences}
                      compact
                      minLevel="playable"
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
