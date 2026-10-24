"use client";
import { StatsViewSkeleton } from "@/components/stats/StatsViewSkeleton";

import { StatsNavigationProvider } from "./StatsNavigationContext";
import React, { Suspense } from "react";
import dynamic from "next/dynamic";

import type { Route } from "next";
import { EmptyState } from "@/components/rivalhub";
import type { TournamentMapDetail } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import type { PublicStatsData } from "@/lib/stats/public-view";
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
  data?: PublicStatsData;
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
  if (query.tab === "overview" && data?.tab === "overview") content = <OverviewStats data={data.overview} query={query} seasonSlug={seasonSlug} />;
  if (query.tab === "players") content = data?.tab === "players"
    ? <PlayersExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="暂无选手统计" />;
  if (query.tab === "teams") content = data?.tab === "teams"
    ? <TeamsExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="暂无队伍统计" />;
  if (query.tab === "maps") content = mapDetail
    ? <MapWorkspace detail={mapDetail} seasonSlug={seasonSlug} teamLinks={data?.teamLinks} />
    : data?.tab === "maps" ? <MapsExplorer data={data} query={query} seasonSlug={seasonSlug} /> : <EmptyState title="暂无地图统计" />;
  if (query.tab === "weapons") content = data?.tab === "weapons"
    ? <WeaponsExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="暂无武器统计" />;

  if (query.tab === "records" && data?.tab === "records") content = <Records records={data.records ?? []} query={query} seasonSlug={seasonSlug} coverage={data.recordCoverage} events={data.recordEvents} counts={data.eventCounts} eventMaps={data.eventMaps} />;

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
      <Suspense fallback={<StatsViewSkeleton />}>{content}</Suspense>
    </StatsShell></StatsNavigationProvider>
  );
}
