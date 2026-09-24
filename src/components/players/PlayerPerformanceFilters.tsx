"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { playerPerformanceHref, type PlayerPerformanceEventOption, type PlayerPerformanceQuery } from "@/lib/players/performance-view-state";

function mapLabel(map: string) {
  return CS2_MAP_CATALOG.find((candidate) => candidate.key === map)?.label ?? map;
}

export function PlayerPerformanceFilters({
  userId,
  events,
  query,
}: {
  userId: string;
  events: readonly (PlayerPerformanceEventOption & { id: string; name: string })[];
  query: PlayerPerformanceQuery;
}) {
  const router = useRouter();
  const maps = query.event ? events.find((event) => event.slug === query.event)?.maps ?? [] : [...new Set(events.flatMap((event) => event.maps))].sort();
  const navigate = (updates: Partial<PlayerPerformanceQuery>) => {
    router.push(playerPerformanceHref(userId, query, updates, events) as Route, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-fg-mid)]">
        <span>Event</span>
        <select
          aria-label="Event"
          value={query.event}
          onChange={(event) => navigate({ event: event.target.value })}
          className="min-h-9 max-w-64 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1 text-sm text-[var(--color-fg)]"
        >
          <option value="">All-time</option>
          {events.map((event) => <option key={event.id} value={event.slug}>{event.name}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-fg-mid)]">
        <span>Map</span>
        <select
          aria-label="Map"
          value={query.map}
          onChange={(event) => navigate({ map: event.target.value })}
          className="min-h-9 max-w-56 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1 text-sm text-[var(--color-fg)]"
        >
          <option value="">All maps</option>
          {maps.map((map) => <option key={map} value={map}>{mapLabel(map)}</option>)}
        </select>
      </label>
    </div>
  );
}
