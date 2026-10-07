import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { competitionEntries, matchMaps, matchVetoSteps, matches, seasons } from "@/db/schema";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { traceOperation } from "@/lib/observability/server";
import { STATISTICS_PROJECTION_VERSION } from "./projection-version";
import { INSIGHT_RULES_VERSION } from "./insights";
import { getTournamentStats, type PlatformStatsScope } from "./tournament-query";
import { buildRecords } from "./records";
import { publicStatsView } from "./public-view";
import { parseStatsQuery, type StatsSearch } from "./view-state";

/** Fresh public membership is part of the cache key, including historical archived events. */
export async function getFreshStatsEvents() {
  return db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name, status: seasons.status, stagePlan: seasons.stagePlan })
    .from(seasons).where(ne(seasons.status, "draft")).orderBy(seasons.id);
}
async function cachedPlatformStats(scope: PlatformStatsScope, versions: string) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
  void versions;
  return traceOperation("stats.public.read", { scope: "statistics", operation: "platform" }, () => getTournamentStats(scope));
}
export async function getPlatformStatsPage(raw: StatsSearch) {
  const events = await getFreshStatsEvents();
  const requestedEvent = raw.event;
  if (requestedEvent !== undefined && (typeof requestedEvent !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(requestedEvent))) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  const event = events.find((e) => e.slug === requestedEvent);
  if (requestedEvent && !event) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  const stages = event ? normalizeStagePlan(event.stagePlan).map(({ key, name }) => ({ key, name })) : [];
  for (const key of ["stage", "format", "mapFilter", "map", "teamFilter"]) {
    const value = raw[key];
    if (value !== undefined && (typeof value !== "string" || value.length > 128)) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  }
  if (raw.format && !["bo1", "bo3", "bo5"].includes(raw.format as string)) throw new AppError(ErrorCode.NOT_FOUND, "赛制范围不可用。");
  const query = parseStatsQuery(raw, stages.map((s) => s.key));
  if ((!event && (raw.stage || raw.teamFilter)) || query.stage === "__invalid__" || query.mapFilter === "__invalid__") throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  const ids = event ? [event.id] : events.map((e) => e.id);
  const maps = events.length ? await db.selectDistinct({ name: matchMaps.mapName, seasonId: matches.seasonId }).from(matchMaps)
    .innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(inArray(matches.seasonId, events.map((e) => e.id))) : [];
  const vetoMaps = events.length ? await db.selectDistinct({ name: matchVetoSteps.mapName, seasonId: matches.seasonId }).from(matchVetoSteps)
    .innerJoin(matches, eq(matches.id, matchVetoSteps.matchId)).where(inArray(matches.seasonId, events.map((e) => e.id))) : [];
  maps.push(...vetoMaps);
  const allowedMaps = [...new Set(maps.filter((m) => m.seasonId !== null && ids.includes(m.seasonId)).map((m) => m.name))].sort();
  if ((raw.map && !/^de_[a-z0-9_]+$/.test(raw.map as string)) || (raw.map && query.tab !== "maps")
    || (query.map && !allowedMaps.includes(query.map)) || (query.mapFilter && !allowedMaps.includes(query.mapFilter))
    || (query.map && query.mapFilter && query.map !== query.mapFilter)) throw new AppError(ErrorCode.NOT_FOUND, "地图范围不可用。");
  if (raw.teamFilter && (!query.teamFilter || (query.tab !== "players" && query.tab !== "weapons"))) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  if (query.teamFilter) {
    const [entry] = await db.select({ id: competitionEntries.id }).from(competitionEntries).where(and(
      eq(competitionEntries.id, query.teamFilter), eq(competitionEntries.competitionId, event!.id), eq(competitionEntries.registrationStatus, "approved"),
    )).limit(1);
    if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
  }
  const scope: PlatformStatsScope = { publicOnly: true, seasonId: event?.id, seasonIds: ids, stage: query.stage || undefined,
    format: query.format || undefined, mapFilter: query.map || query.mapFilter || undefined, weaponTeamId: query.tab === "weapons" ? query.teamFilter || undefined : undefined };
  // Entity filtering is presentation only: qualification/Insights use the full scoped population.
  let data = await cachedPlatformStats(scope, `${STATISTICS_PROJECTION_VERSION}:insights/${INSIGHT_RULES_VERSION}`);
  const requestedPage = raw.recordPage;
  if (requestedPage !== undefined) {
    if (query.tab !== "records" || typeof requestedPage !== "string" || !/^[1-9][0-9]{0,5}$/.test(requestedPage)) throw new AppError(ErrorCode.NOT_FOUND, "纪录页不可用。");
    const page = Number(requestedPage), max = Math.max(1, ...(data.records ?? []).map((r) => r.pages));
    if (page > max) throw new AppError(ErrorCode.NOT_FOUND, "纪录页不可用。");
    query.recordPage = page;
    if (page > 1) data = { ...data, records: buildRecords(data.recordTies ?? [], page) };
  }
  return { data: publicStatsView(data, query), query, event, stages, maps: allowedMaps, events: events.map(({ id, slug, name, status }) => ({ slug, name, status, maps: [...new Set(maps.filter((m) => m.seasonId === id).map((m) => m.name))].sort() })) };
}
