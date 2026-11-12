import {
  labelPerformancePlayer,
  labelScoreboardPlayer,
  withPublicPlayerLabels,
  type PlayerLabel,
} from "./public-player-labels";
import { getMatchPerformance } from "./match-performance-query";
import { preservePublicStatsDependencyFailure } from "./availability";
import { observePublicStatsFill } from "./public-fill";
import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { cache } from "react";
import { db } from "@/db/client";
import { competitionEntries, matches, seasons } from "@/db/schema";
import { publicCompetitionEntryIdentityCondition } from "@/lib/competition-entries/public-visibility";
import {
  ALL_EVENT_STATS_TAG,
  PUBLIC_STATS_TAG,
  eventStatsTag,
  matchStatsTag,
} from "@/lib/cache/tags";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  getPublicSeasonStagePresentation,
  type PublicStageSeason,
} from "@/lib/seasons/public-stage";
import { isOfficialStageKey } from "@/lib/seasons/official-stages";
import {
  getLongTeamCareerDetail,
  getPlayerCareerDetail,
  getPlayerCareerFilterOptions,
  getTournamentTeamDetail,
  type TournamentTeamDetail,
} from "./tournament-query";
import type { TournamentStatsScope } from "./types";

type Visibility = "public" | "draft";
type PlayerCareerScope = Parameters<typeof getPlayerCareerDetail>[0];
type TeamScope = Parameters<typeof getTournamentTeamDetail>[0];

/** Kept outside the cached scope: withdrawing an event must close access immediately. */
async function requirePublicSeason(seasonId: string) {
  const [season] = await db
    .select({
      id: seasons.id,
      stagePlan: seasons.stagePlan,
      competitionTemplate: seasons.competitionTemplate,
    })
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), ne(seasons.status, "draft")))
    .limit(1);
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在或尚未公开。");
  return season;
}

const knownMaps = new Set<string>(CS2_MAP_CATALOG.map(({ key }) => key));
// All unknown map filters represent the same empty sample, without unbounded cache keys.
const EMPTY_MAP_FILTER = "__unknown_map__";

async function normalizeScope(
  scope: TournamentStatsScope,
  season: PublicStageSeason,
): Promise<TournamentStatsScope> {
  if (
    scope.stage &&
    !isOfficialStageKey(
      (await getPublicSeasonStagePresentation(season)).officialStages,
      scope.stage,
    )
  ) {
    throw new AppError(ErrorCode.NOT_FOUND, "统计阶段不可用。");
  }
  return {
    seasonId: scope.seasonId,
    stage: scope.stage,
    format: scope.format,
    mapFilter: scope.mapFilter
      ? knownMaps.has(scope.mapFilter)
        ? scope.mapFilter
        : EMPTY_MAP_FILTER
      : undefined,
    teamFilter: scope.teamFilter?.toLowerCase() || undefined,
  };
}

async function requirePublicEntry(seasonId: string, entryId: string): Promise<void> {
  const [entry] = await db
    .select({ id: competitionEntries.id })
    .from(competitionEntries)
    .where(
      and(
        eq(competitionEntries.id, entryId),
        eq(competitionEntries.competitionId, seasonId),
        publicCompetitionEntryIdentityCondition(),
      ),
    )
    .limit(1);
  if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "参赛队伍不存在或尚未公开。");
}

function statsCachePolicy(seasonId?: string): void {
  if (seasonId) cacheTag(ALL_EVENT_STATS_TAG, eventStatsTag(seasonId));
  else cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
}

async function cachedTournamentTeam(scope: TeamScope) {
  "use cache: remote";
  statsCachePolicy(scope.seasonId);
  return observePublicStatsFill("stats.tournament", async () =>
    preservePublicStatsDependencyFailure(() => getTournamentTeamDetail(scope)),
  );
}

function labelTeamPlayers<T extends Pick<TournamentTeamDetail, "scoreboard" | "detailedPlayers">>(
  data: T,
  label: PlayerLabel,
): T {
  return {
    ...data,
    scoreboard: data.scoreboard.map((row) => labelScoreboardPlayer(row, label)),
    detailedPlayers: data.detailedPlayers.map((row) => labelPerformancePlayer(row, label)),
  };
}

/** Entrypoints authorize draft access before calling; draft results never enter the remote cache. */
export async function getPublicTournamentTeamDetail(scope: TeamScope, visibility: Visibility) {
  if (visibility === "draft") return getTournamentTeamDetail(scope);
  const season = await requirePublicSeason(scope.seasonId);
  await requirePublicEntry(scope.seasonId, scope.teamId);
  const detail = await cachedTournamentTeam({ ...(await normalizeScope(scope, season)), teamId: scope.teamId });
  return withPublicPlayerLabels((label) => labelTeamPlayers(detail, label));
}

/** The canonical career queries themselves restrict the corpus to public events. */
async function cachedPlayerCareerDetail(scope: PlayerCareerScope) {
  "use cache: remote";
  statsCachePolicy();
  return observePublicStatsFill("stats.career", async () =>
    preservePublicStatsDependencyFailure(() => getPlayerCareerDetail(scope)),
  );
}

async function cachedPlayerFilterOptions(playerId: string) {
  "use cache: remote";
  statsCachePolicy();
  return observePublicStatsFill("stats.career", () =>
    preservePublicStatsDependencyFailure(() => getPlayerCareerFilterOptions(playerId)),
  );
}

export async function getPublicPlayerCareerDetail(scope: PlayerCareerScope) {
  let eventSlug: string | undefined;
  let mapFilter: string | undefined;
  if (scope.eventSlug || scope.mapFilter) {
    const events = await cachedPlayerFilterOptions(scope.playerId);
    const event = events.find(({ slug }) => slug === scope.eventSlug);
    eventSlug = event?.slug;
    const allowedMaps = event?.maps ?? events.flatMap(({ maps }) => maps);
    mapFilter =
      scope.mapFilter && allowedMaps.includes(scope.mapFilter) ? scope.mapFilter : undefined;
  }
  const detail = await cachedPlayerCareerDetail({ playerId: scope.playerId, eventSlug, mapFilter });
  return withPublicPlayerLabels((label) => ({
    ...detail,
    scoreboard: detail.scoreboard.map((row) => labelScoreboardPlayer(row, label)),
    scoreboardMaps: detail.scoreboardMaps.map((row) => labelScoreboardPlayer(row, label)),
    performance: detail.performance && labelPerformancePlayer(detail.performance, label),
    maps: detail.maps.map((row) => ({
      ...row,
      performance: row.performance && labelPerformancePlayer(row.performance, label),
    })),
  }));
}

async function cachedLongTeamCareerDetail(teamId: string) {
  "use cache: remote";
  statsCachePolicy();
  return observePublicStatsFill("stats.career", async () =>
    preservePublicStatsDependencyFailure(() => getLongTeamCareerDetail(teamId)),
  );
}

export async function getPublicLongTeamCareerDetail(teamId: string) {
  const detail = await cachedLongTeamCareerDetail(teamId);
  return withPublicPlayerLabels((label) => labelTeamPlayers(detail, label));
}

// Share only the public visibility probe within a server render; never cache draft access.
const isPublicMatch = cache(async (matchId: string) => {
  const [match] = await db
    .select({ seasonId: seasons.id })
    .from(matches)
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(eq(matches.id, matchId), ne(seasons.status, "draft")))
    .limit(1);
  return match?.seasonId;
});

async function cachedMatchPerformance({ matchId }: { matchId: string; seasonId: string }) {
  "use cache: remote";
  cacheTag(ALL_EVENT_STATS_TAG, matchStatsTag(matchId));
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  return observePublicStatsFill("stats.match", () =>
    preservePublicStatsDependencyFailure(() => getMatchPerformance(matchId)),
  );
}

/** One match-scoped cache entry is shared by the scoreboard, all players and MVP. */
export async function getPublicMatchPerformance(matchId: string, visibility: Visibility) {
  if (visibility === "draft") return getMatchPerformance(matchId);
  const seasonId = await isPublicMatch(matchId);
  if (!seasonId) return null;
  const performance = await cachedMatchPerformance({ matchId, seasonId });
  return withPublicPlayerLabels((label) => ({
    ...performance,
    overall: performance.overall.map((row) => labelPerformancePlayer(row, label)),
    byMap: Object.fromEntries(Object.entries(performance.byMap).map(([key, rows]) => [
      key,
      rows.map((row) => labelPerformancePlayer(row, label)),
    ])),
  }));
}
