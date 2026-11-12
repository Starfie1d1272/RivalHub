import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import {
  recordStatsInvalidation,
  type StatsInvalidationReason,
} from "@/lib/observability/read-budget";

import {
  PUBLIC_ANNOUNCEMENTS_TAG,
  PUBLIC_HOME_TAG,
  PUBLIC_SEASON_CATALOG_TAG,
  PUBLIC_STATS_TAG,
  PUBLIC_STATS_PLAYER_NAMES_TAG,
  ALL_EVENT_STATS_TAG,
  eventStatsTag,
  matchStatsTag,
  publicPlayerTag,
  publicAnnouncementsSeasonTag,
  publicSeasonTag,
  publicSeasonInfoTag,
  seasonMatchesTag,
  seasonParticipantsTag,
  seasonStandingsTag,
} from "@/lib/cache/tags";

const seasonPages = {
  matches: (slug: string) => `/${slug}/matches`,
  captains: (slug: string) => `/${slug}/captains`,
  teams: (slug: string) => `/${slug}/teams`,
  draft: (slug: string) => `/${slug}/draft`,
  draftCaptain: (slug: string) => `/${slug}/draft/captain`,
  register: (slug: string) => `/${slug}/register`,
  adminMatches: (slug: string) => `/admin/${slug}/matches`,
  adminCaptains: (slug: string) => `/admin/${slug}/captains`,
  adminDraft: (slug: string) => `/admin/${slug}/draft`,
  adminRegistrations: (slug: string) => `/admin/${slug}/registrations`,
  adminSeasons: (slug: string) => `/admin/${slug}/seasons`,
} as const;

type SeasonPage = keyof typeof seasonPages;
type RevalidationMode = "action" | "route";
type StatisticsScope =
  "all" | { seasonId: string; matchId?: string } | { seasonIds: readonly string[] };
type RevalidationOptions = {
  mode?: RevalidationMode;
  statistics?: StatisticsScope;
  statisticsReason?: StatsInvalidationReason;
  seenTags?: Map<string, boolean>;
};

/** Server Action semantics: invalidate immediately for read-your-own-writes. */
export function updatePublicSeasonTags(
  slug: string,
  seasonId?: string,
  options: RevalidationOptions = {},
): void {
  if (options.statistics)
    expirePublicStatsTags(options.statistics, "action", options.statisticsReason, options.seenTags);
  expirePublicTag(PUBLIC_SEASON_CATALOG_TAG, "action", options.seenTags);
  expirePublicTag(publicSeasonTag(slug), "action", options.seenTags);
  expirePublicTag(PUBLIC_HOME_TAG, "action", options.seenTags);
  if (seasonId) {
    expirePublicTag(seasonParticipantsTag(seasonId), "action", options.seenTags);
    expirePublicTag(seasonMatchesTag(seasonId), "action", options.seenTags);
    expirePublicTag(seasonStandingsTag(seasonId), "action", options.seenTags);
  }
}

/** Route Handler/webhook semantics: expire home and its catalog input immediately. */
export function revalidatePublicSeasonTags(
  slug: string,
  seasonId?: string,
  options: RevalidationOptions = {},
): void {
  if (options.statistics)
    expirePublicStatsTags(options.statistics, "route", options.statisticsReason, options.seenTags);
  expirePublicTag(PUBLIC_SEASON_CATALOG_TAG, "route", options.seenTags);
  expirePublicTag(publicSeasonTag(slug), "route", options.seenTags, "max");
  expirePublicTag(PUBLIC_HOME_TAG, "route", options.seenTags);
  if (seasonId) {
    expirePublicTag(seasonParticipantsTag(seasonId), "route", options.seenTags, "max");
    expirePublicTag(seasonMatchesTag(seasonId), "route", options.seenTags, "max");
    expirePublicTag(seasonStandingsTag(seasonId), "route", options.seenTags, "max");
  }
}

export function revalidatePublicHomeTag(): void {
  revalidateTag(PUBLIC_HOME_TAG, { expire: 0 });
}

export function updatePublicHomeTag(): void {
  updateTag(PUBLIC_HOME_TAG);
}

export function updatePublicAnnouncementTags(seasonId?: string | null): void {
  updateTag(PUBLIC_ANNOUNCEMENTS_TAG);
  if (seasonId) updateTag(publicAnnouncementsSeasonTag(seasonId));
}

export function updatePublicSeasonInfoTag(seasonId: string): void {
  updateTag(publicSeasonInfoTag(seasonId));
}

export function revalidatePublicPlayerTags(userIds: readonly string[], namesChanged = false): void {
  if (!userIds.length) return;
  for (const userId of userIds) revalidateTag(publicPlayerTag(userId), "max");
  revalidatePublicHomeTag();
  if (namesChanged) revalidatePublicStatsPlayerNames();
}

export function updatePublicPlayerTag(userId: string): void {
  updateTag(publicPlayerTag(userId));
  updatePublicHomeTag();
}

export function revalidatePublicStatsPlayerNames(): void {
  revalidateTag(PUBLIC_STATS_PLAYER_NAMES_TAG, { expire: 0 });
}

export function updatePublicStatsPlayerNames(): void {
  updateTag(PUBLIC_STATS_PLAYER_NAMES_TAG);
}

export function expirePublicTag(
  tag: string,
  mode: RevalidationMode,
  seen?: Map<string, boolean>,
  profile?: "max",
): void {
  if (seen?.has(tag)) return;
  if (mode === "action") updateTag(tag);
  else revalidateTag(tag, profile ?? { expire: 0 });
  seen?.set(tag, mode === "action" || !profile);
}

function expirePublicStatsTags(
  scope: StatisticsScope,
  mode: RevalidationMode,
  reason: StatsInvalidationReason = "season_or_other",
  seen?: Map<string, boolean>,
): void {
  const tags = [PUBLIC_STATS_TAG];
  if (scope === "all") tags.push(ALL_EVENT_STATS_TAG);
  else if ("seasonIds" in scope) tags.push(...scope.seasonIds.map(eventStatsTag));
  else {
    tags.push(eventStatsTag(scope.seasonId));
    if (scope.matchId) tags.push(matchStatsTag(scope.matchId));
  }
  if (tags.every((tag) => seen?.has(tag))) return;
  recordStatsInvalidation(reason, "attempted");
  try {
    for (const tag of tags) expirePublicTag(tag, mode, seen);
    recordStatsInvalidation(reason, "completed");
  } catch (error) {
    recordStatsInvalidation(reason, "failed");
    throw error;
  }
}

export function updatePublicStatsTag(
  reason: StatsInvalidationReason,
  scope: StatisticsScope,
): void {
  expirePublicStatsTags(scope, "action", reason);
}

export function revalidateSeasonPaths(
  slug: string,
  pages: SeasonPage[],
  options: RevalidationOptions = {},
) {
  if (options.mode === "route") {
    revalidatePublicSeasonTags(slug, undefined, options);
  } else {
    updatePublicSeasonTags(slug, undefined, options);
  }
  for (const page of pages) {
    revalidatePath(seasonPages[page](slug));
  }
}

export function revalidateMatchPaths(
  slug: string,
  matchId: string,
  options: RevalidationOptions = {},
) {
  revalidateSeasonPaths(slug, ["matches", "adminMatches"], options);
  revalidatePath(`/admin/${slug}/matches/${matchId}`);
  revalidatePath(`/admin/${slug}/test-matches`);
  revalidatePath("/my/competitions");
  revalidatePath(`/${slug}/matches/${matchId}`);
}
