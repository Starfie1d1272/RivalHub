import { withDbTrafficSource } from "@/lib/observability/db-traffic";
import { observePublicStatsFill } from "@/lib/stats/public-fill";
import { observeStatsCacheFill, recordStatsCache } from "@/lib/observability/read-budget";
import { preservePublicStatsDependencyFailure } from "./availability";
import "server-only";
import { cache } from "react";
import { officialMatchCondition } from "@/lib/matches/scope";
import { and, eq, inArray, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { competitionEntries, matchMaps, matchVetoSteps, matches, seasons } from "@/db/schema";
import { publicCompetitionEntryIdentityCondition } from "@/lib/competition-entries/public-visibility";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { AppError, ErrorCode } from "@/lib/errors";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { STATISTICS_PROJECTION_VERSION } from "./projection-version";
import { INSIGHT_RULES_VERSION } from "./insights";
import { getTournamentStats, getTournamentRecordEvents, type PlatformStatsScope } from "./tournament-query";
import { buildRecords } from "./records";
import { publicStatsView } from "./public-view";
import { parseStatsQuery, type StatsSearch } from "./view-state";

/** Fresh public membership is part of the cache key, including historical archived events. */
export const getFreshStatsEvents = cache(async function getFreshStatsEvents() {
  return db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name, status: seasons.status, stagePlan: seasons.stagePlan, competitionTemplate: seasons.competitionTemplate })
    .from(seasons).where(ne(seasons.status, "draft")).orderBy(seasons.id);
});
/** Map/BP discovery shares the formal scope of the statistics it filters. */
export async function getOfficialStatsMapCatalog(seasonIds: string[]) {
  if (!seasonIds.length) return [];
  return db.selectDistinct({ name: matchMaps.mapName, seasonId: matches.seasonId }).from(matchMaps)
    .innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(and(officialMatchCondition(), inArray(matches.seasonId, seasonIds)))
    .unionAll(db.selectDistinct({ name: matchVetoSteps.mapName, seasonId: matches.seasonId }).from(matchVetoSteps)
    .innerJoin(matches, eq(matches.id, matchVetoSteps.matchId)).where(and(officialMatchCondition(), inArray(matches.seasonId, seasonIds))));
}
async function cachedPlatformStats(scope: PlatformStatsScope, versions: string) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
  void versions;
  return observeStatsCacheFill("platform", () => observePublicStatsFill("stats.platform", () => preservePublicStatsDependencyFailure(() => getTournamentStats(scope))));
}
export async function getPlatformStatsPage(raw: StatsSearch) {
  return withDbTrafficSource("stats.platform.page", async () => {
  const events = await getFreshStatsEvents();
  const requestedEvent = raw.event;
  if (requestedEvent !== undefined && (typeof requestedEvent !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(requestedEvent))) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  const event = events.find((e) => e.slug === requestedEvent);
  if (requestedEvent && !event) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  for (const key of ["stage", "format", "mapFilter", "map", "teamFilter"]) {
    const value = raw[key];
    if (value !== undefined && (typeof value !== "string" || value.length > 128)) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  }
  if (raw.format && !["bo1", "bo3", "bo5"].includes(raw.format as string)) throw new AppError(ErrorCode.NOT_FOUND, "赛制范围不可用。");
  const [stages, maps] = await Promise.all([
    event ? getPublicSeasonStagePresentation(event).then(presentation => presentation.officialStages.map(({ key, name }) => ({ key, name }))) : Promise.resolve([]),
    getOfficialStatsMapCatalog(events.map(e => e.id)),
  ]);
  const query = parseStatsQuery(raw, stages.map((s) => s.key));
  if ((!event && (raw.stage || raw.teamFilter)) || query.stage === "__invalid__" || query.mapFilter === "__invalid__") throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  const ids = event ? [event.id] : events.map((e) => e.id);
  const allowedMaps = [...new Set(maps.filter((m) => m.seasonId !== null && ids.includes(m.seasonId)).map((m) => m.name))].sort();
  if ((raw.map && !/^de_[a-z0-9_]+$/.test(raw.map as string)) || (raw.map && query.tab !== "maps")
    || (query.map && !allowedMaps.includes(query.map)) || (query.mapFilter && !allowedMaps.includes(query.mapFilter))
    || (query.map && query.mapFilter && query.map !== query.mapFilter)) throw new AppError(ErrorCode.NOT_FOUND, "地图范围不可用。");
  if (raw.teamFilter && (!query.teamFilter || (query.tab !== "players" && query.tab !== "weapons"))) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  if (query.teamFilter) {
    const [entry] = await db.select({ id: competitionEntries.id }).from(competitionEntries).where(and(
      eq(competitionEntries.id, query.teamFilter), eq(competitionEntries.competitionId, event!.id), publicCompetitionEntryIdentityCondition(),
    )).limit(1);
    if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  }
  const scope: PlatformStatsScope = { publicOnly: true, view: query.tab, mapDetail: Boolean(query.map), seasonId: event?.id, seasonIds: ids, stage: query.stage || undefined,
    format: query.format || undefined, mapFilter: query.map || query.mapFilter || undefined, weaponTeamId: query.tab === "weapons" ? query.teamFilter || undefined : undefined };
  // Entity filtering is presentation only: qualification/Insights use the full scoped population.
  recordStatsCache("platform", "readCalls");
  let data = await cachedPlatformStats(scope, `${STATISTICS_PROJECTION_VERSION}:insights/${INSIGHT_RULES_VERSION}`);
  const requestedPage = raw.recordPage;
  if (requestedPage !== undefined) {
    if (query.tab !== "records" || typeof requestedPage !== "string" || !/^[1-9][0-9]{0,5}$/.test(requestedPage)) throw new AppError(ErrorCode.NOT_FOUND, "纪录页不可用。");
    const page = Number(requestedPage), max = Math.max(1, ...(data.records ?? []).map((r) => r.pages));
    if (page > max) throw new AppError(ErrorCode.NOT_FOUND, "纪录页不可用。");
    query.recordPage = page;
    if (page > 1) data = { ...data, records: buildRecords(data.recordTies ?? [], page) };
  }
  for (const key of ["eventType", "eventWeapon", "eventPage"] as const) {
    if (raw[key] !== undefined && (query.tab !== "records" || typeof raw[key] !== "string" ||
      (key === "eventPage" ? !/^[1-9][0-9]{0,5}$/.test(raw[key] as string) : raw[key] !== query[key]))) throw new AppError(ErrorCode.NOT_FOUND, "事件范围不可用。");
  }
  if (query.tab === "records") data = { ...data, recordEvents: await getTournamentRecordEvents(scope, query) };
  return { data: publicStatsView(data, query), query, event, stages, maps: allowedMaps, events: events.map(({ id, slug, name, status }) => ({ slug, name, status, maps: [...new Set(maps.filter((m) => m.seasonId === id).map((m) => m.name))].sort() })) };
  });
}
