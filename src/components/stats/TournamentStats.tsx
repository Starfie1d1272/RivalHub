"use client";
import React from "react";

import type { Route } from "next";
import { EmptyState } from "@/components/rivalhub";
import type { TournamentMapDetail, TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { Records } from "./Records";
import { StatsShell } from "./StatsShell";
import { OverviewStats } from "./overview/OverviewStats";
import { PlayersExplorer } from "./players/PlayersExplorer";
import { TeamsExplorer } from "./teams/TeamsExplorer";
import { MapsExplorer } from "./maps/MapsExplorer";
import { MapWorkspace } from "./maps/MapWorkspace";
import { WeaponsExplorer } from "./weapons/WeaponsExplorer";

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
    : <EmptyState title="选手数据确认后展示" />;
  if (query.tab === "teams") content = data
    ? <TeamsExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="队伍数据确认后展示" />;
  if (query.tab === "maps") content = mapDetail
    ? <MapWorkspace detail={mapDetail} seasonSlug={seasonSlug} teamLinks={data?.teamLinks} />
    : data ? <MapsExplorer data={data} query={query} seasonSlug={seasonSlug} /> : <EmptyState title="地图数据确认后展示" />;
  if (query.tab === "weapons") content = data
    ? <WeaponsExplorer data={data} query={query} seasonSlug={seasonSlug} />
    : <EmptyState title="武器数据确认后展示" />;

  if (query.tab === "records" && data) content = <Records records={data.records ?? []} query={query} seasonSlug={seasonSlug} coverage={data.recordCoverage} />;

  return (
    <StatsShell
      query={query}
      seasonSlug={seasonSlug}
      stages={stages}
      coverage={coverage}
      maps={data?.options.maps ?? []}
      selectedTitle={selectedTitle}
      directoryHref={directoryHref}
      directoryLabel={directoryLabel}
    >
      {content}
    </StatsShell>
  );
}
