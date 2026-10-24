"use client";
import { StatsNavigationProvider } from "./StatsNavigationContext";
import React, { Suspense } from "react";
import dynamic from "next/dynamic";

import type { Route } from "next";
import { EmptyState } from "@/components/rivalhub";
import type { TournamentMapDetail, TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { StatsShell } from "./StatsShell";

const Records = dynamic(() => import("./Records").then((module) => module.Records));
const OverviewStats = dynamic(() => import("./overview/OverviewStats").then((module) => module.OverviewStats));
const PlayersExplorer = dynamic(() => import("./players/PlayersExplorer").then((module) => module.PlayersExplorer));
const TeamsExplorer = dynamic(() => import("./teams/TeamsExplorer").then((module) => module.TeamsExplorer));
const MapsExplorer = dynamic(() => import("./maps/MapsExplorer").then((module) => module.MapsExplorer));
const MapWorkspace = dynamic(() => import("./maps/MapWorkspace").then((module) => module.MapWorkspace));
const WeaponsExplorer = dynamic(() => import("./weapons/WeaponsExplorer").then((module) => module.WeaponsExplorer));

export function TournamentStatsView({
  data,
  mapDetail,
  query,
  seasonSlug,
  stages,
}: {
  data?: TournamentStats;
  mapDetail?: TournamentMapDetail;
  query: StatsQuery;
  seasonSlug: string;
  stages: { key: string; name: string }[];
}) {
  const coverage = mapDetail?.coverage ?? data?.coverage ?? { detailedMaps: 0, completedMaps: 0 };
  let selectedTitle: string | undefined;
  let directoryHref: Route | undefined;
  let directoryLabel: string | undefined;

  if (mapDetail) {
    selectedTitle = CS2_MAP_CATALOG.find((row) => row.key === mapDetail.map)?.label ?? mapDetail.map;
    directoryHref = statsHref(seasonSlug, query, { map: "" });
    directoryLabel = "全部地图";
  }

  let content = <EmptyState title="选择统计范围" />;
  if (query.tab === "overview" && data) content = <OverviewStats data={data} query={query} seasonSlug={seasonSlug} />;
  if (query.tab === "players") content = data
    ? <PlayersExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="暂无选手统计" />;
  if (query.tab === "teams") content = data
    ? <TeamsExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="暂无队伍统计" />;
  if (query.tab === "maps") content = mapDetail
    ? <MapWorkspace detail={mapDetail} seasonSlug={seasonSlug} teamLinks={data?.teamLinks} />
    : data ? <MapsExplorer data={data} query={query} seasonSlug={seasonSlug} /> : <EmptyState title="暂无地图统计" />;
  if (query.tab === "weapons") content = data
    ? <WeaponsExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="暂无武器统计" />;

  if (query.tab === "records" && data) content = <Records records={data.records ?? []} query={query} seasonSlug={seasonSlug} coverage={data.recordCoverage} events={data.recordEvents} counts={data.eventCounts} eventMaps={data.eventMaps} />;

  return (
    <StatsNavigationProvider><StatsShell
      query={query}
      seasonSlug={seasonSlug}
      stages={stages}
      coverage={coverage}
      maps={data?.options.maps ?? []}
      selectedTitle={selectedTitle}
      directoryHref={directoryHref}
      directoryLabel={directoryLabel}
    >
      <Suspense fallback={<p role="status" className="py-6 text-sm text-[var(--color-fg-mid)]">正在加载统计视图…</p>}>{content}</Suspense>
    </StatsShell></StatsNavigationProvider>
  );
}
