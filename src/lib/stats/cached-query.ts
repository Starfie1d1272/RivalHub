import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { competitionEntries, matches, seasons } from "@/db/schema";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { AppError, ErrorCode } from "@/lib/errors";
import { traceOperation } from "@/lib/observability/server";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import {
  getLongTeamCareerDetail,
  getMatchPlayerDetail,
  getPlayerCareerDetail,
  getPlayerCareerFilterOptions,
  getTournamentMapDetail,
  getTournamentStats,
  getTournamentTeamDetail,
  type TournamentStatsScope,
} from "./tournament-query";

type Visibility = "public" | "draft";
type PlayerCareerScope = Parameters<typeof getPlayerCareerDetail>[0];
type TeamScope = Parameters<typeof getTournamentTeamDetail>[0];
type MapScope = Parameters<typeof getTournamentMapDetail>[0];

/** Kept outside the cached scope: withdrawing an event must close access immediately. */
async function requirePublicSeason(seasonId: string) {
  const [season] = await db.select({ id: seasons.id, stagePlan: seasons.stagePlan }).from(seasons)
    .where(and(eq(seasons.id, seasonId), ne(seasons.status, "draft"))).limit(1);
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在或尚未公开。");
  return season;
}

const knownMaps = new Set<string>(CS2_MAP_CATALOG.map(({ key }) => key));
// All unknown map filters represent the same empty sample, without unbounded cache keys.
const EMPTY_MAP_FILTER = "__unknown_map__";

function normalizeScope(scope: TournamentStatsScope, stagePlan: Parameters<typeof normalizeStagePlan>[0]): TournamentStatsScope {
  return {
    seasonId: scope.seasonId,
    stage: scope.stage && normalizeStagePlan(stagePlan).some(({ key }) => key === scope.stage) ? scope.stage : undefined,
    format: scope.format,
    mapFilter: scope.mapFilter ? knownMaps.has(scope.mapFilter) ? scope.mapFilter : EMPTY_MAP_FILTER : undefined,
    teamFilter: scope.teamFilter?.toLowerCase() || undefined,
  };
}

async function requirePublicEntry(seasonId: string, entryId: string): Promise<void> {
  const [entry] = await db.select({ id: competitionEntries.id }).from(competitionEntries)
    .where(and(eq(competitionEntries.id, entryId), eq(competitionEntries.competitionId, seasonId), eq(competitionEntries.registrationStatus, "approved"))).limit(1);
  if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "参赛队伍不存在或尚未公开。");
}

function statsCachePolicy(): void {
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
}

async function cachedTournamentStats(scope: TournamentStatsScope) {
  "use cache: remote";
  statsCachePolicy();
  return traceOperation("stats.public.read", { scope: "statistics", operation: "tournament" }, () => getTournamentStats(scope));
}

async function cachedTournamentTeam(scope: TeamScope) {
  "use cache: remote";
  statsCachePolicy();
  return traceOperation("stats.public.read", { scope: "statistics", operation: "event_team" }, () => getTournamentTeamDetail(scope));
}

async function cachedTournamentMap(scope: MapScope) {
  "use cache: remote";
  statsCachePolicy();
  return traceOperation("stats.public.read", { scope: "statistics", operation: "map" }, () => getTournamentMapDetail(scope));
}

/** Entrypoints authorize draft access before calling; draft results never enter the remote cache. */
export async function getPublicTournamentStats(scope: TournamentStatsScope, visibility: Visibility) {
  if (visibility === "draft") return getTournamentStats(scope);
  const season = await requirePublicSeason(scope.seasonId);
  if (scope.teamFilter) await requirePublicEntry(scope.seasonId, scope.teamFilter);
  return cachedTournamentStats(normalizeScope(scope, season.stagePlan));
}

export async function getPublicTournamentTeamDetail(scope: TeamScope, visibility: Visibility) {
  if (visibility === "draft") return getTournamentTeamDetail(scope);
  const season = await requirePublicSeason(scope.seasonId);
  await requirePublicEntry(scope.seasonId, scope.teamId);
  return cachedTournamentTeam({ ...normalizeScope(scope, season.stagePlan), teamId: scope.teamId });
}

export async function getPublicTournamentMapDetail(scope: MapScope, visibility: Visibility) {
  if (visibility === "draft") return getTournamentMapDetail(scope);
  const season = await requirePublicSeason(scope.seasonId);
  if (!knownMaps.has(scope.map)) throw new AppError(ErrorCode.NOT_FOUND, "地图不存在。");
  const { seasonId, stage, format } = normalizeScope(scope, season.stagePlan);
  return cachedTournamentMap({ seasonId, stage, format, map: scope.map });
}

/** The canonical career queries themselves restrict the corpus to public events. */
async function cachedPlayerCareerDetail(scope: PlayerCareerScope) {
  "use cache: remote";
  statsCachePolicy();
  return traceOperation("stats.public.read", { scope: "statistics", operation: "player_career" }, () => getPlayerCareerDetail(scope));
}

async function cachedPlayerFilterOptions(playerId: string) {
  "use cache: remote";
  statsCachePolicy();
  return getPlayerCareerFilterOptions(playerId);
}

export async function getPublicPlayerCareerDetail(scope: PlayerCareerScope) {
  let eventSlug: string | undefined;
  let mapFilter: string | undefined;
  if (scope.eventSlug || scope.mapFilter) {
    const events = await cachedPlayerFilterOptions(scope.playerId);
    const event = events.find(({ slug }) => slug === scope.eventSlug);
    eventSlug = event?.slug;
    const allowedMaps = event?.maps ?? events.flatMap(({ maps }) => maps);
    mapFilter = scope.mapFilter && allowedMaps.includes(scope.mapFilter) ? scope.mapFilter : undefined;
  }
  return cachedPlayerCareerDetail({ playerId: scope.playerId, eventSlug, mapFilter });
}

export async function getPublicLongTeamCareerDetail(teamId: string) {
  "use cache: remote";
  statsCachePolicy();
  return traceOperation("stats.public.read", { scope: "statistics", operation: "team_career" }, () => getLongTeamCareerDetail(teamId));
}

async function cachedMatchPlayerDetail(matchId: string, playerId: string, mapName?: string) {
  "use cache: remote";
  statsCachePolicy();
  return traceOperation("stats.public.read", { scope: "statistics", operation: "match_player" }, () => getMatchPlayerDetail(matchId, playerId, mapName));
}

export async function getPublicMatchPlayerDetail(
  matchId: string,
  playerId: string,
  mapName: string | undefined,
  visibility: Visibility,
) {
  if (visibility === "draft") return getMatchPlayerDetail(matchId, playerId, mapName);
  const [match] = await db.select({ id: matches.id }).from(matches)
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(eq(matches.id, matchId), ne(seasons.status, "draft"))).limit(1);
  if (!match) return null;
  return cachedMatchPlayerDetail(matchId, playerId, mapName);
}
