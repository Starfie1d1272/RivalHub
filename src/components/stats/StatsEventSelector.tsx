"use client";
import React from "react";
import { EventSelector, type EventOption } from "@/components/layout/EventSelector";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
export function StatsEventSelector({ events, value, query }: { events: EventOption[]; value: string; query: StatsQuery }) {
  const clean = { ...query, stage: "", teamFilter: "", mapFilter: "", map: "", player: "", team: "", mapsView: "pool" as const, recordPage: 1 };
  const mapScope = query.map || query.mapFilter;
  const forEvent = (slug: string) => {
    if (slug === value) return statsHref(slug, query);
    const maps = slug ? events.find((e) => e.slug === slug)?.maps ?? [] : events.flatMap((e) => e.maps ?? []);
    return statsHref(slug, { ...clean, mapFilter: maps.includes(mapScope) ? mapScope : "" });
  };
  return <EventSelector events={events} value={value} allHref={forEvent("")} hrefFor={forEvent} />;
}
