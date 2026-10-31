import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { recordStatsInvalidation, type StatsInvalidationReason } from "@/lib/observability/read-budget";

import {
  PUBLIC_ANNOUNCEMENTS_TAG,
  PUBLIC_HOME_TAG,
  PUBLIC_SEASON_CATALOG_TAG,
  PUBLIC_STATS_TAG,
  publicPlayerTag,
  publicBetTag,
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
type StatisticsRevalidationOptions = { statistics?: boolean; statisticsReason?: StatsInvalidationReason };
type RevalidationOptions = StatisticsRevalidationOptions & { mode?: RevalidationMode };

/** Server Action semantics: invalidate immediately for read-your-own-writes. */
export function updatePublicSeasonTags(
  slug: string,
  seasonId?: string,
  options: StatisticsRevalidationOptions = {},
): void {
  if (options.statistics !== false) updatePublicStatsTag(options.statisticsReason);
  updateTag(PUBLIC_SEASON_CATALOG_TAG);
  updateTag(publicSeasonTag(slug));
  updatePublicHomeTag();
  if (seasonId) {
    updateTag(seasonParticipantsTag(seasonId));
    updateTag(seasonMatchesTag(seasonId));
    updateTag(seasonStandingsTag(seasonId));
  }
}

/** Route Handler/webhook semantics: stale-while-revalidate the public tags. */
export function revalidatePublicSeasonTags(
  slug: string,
  seasonId?: string,
  options: StatisticsRevalidationOptions = {},
): void {
  if (options.statistics !== false) revalidatePublicStatsTag(options.statisticsReason);
  revalidateTag(PUBLIC_SEASON_CATALOG_TAG, "max");
  revalidateTag(publicSeasonTag(slug), "max");
  revalidateTag(PUBLIC_HOME_TAG, "max");
  if (seasonId) {
    revalidateTag(seasonParticipantsTag(seasonId), "max");
    revalidateTag(seasonMatchesTag(seasonId), "max");
    revalidateTag(seasonStandingsTag(seasonId), "max");
  }
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

export function revalidatePublicPlayerTag(userId: string): void {
  revalidateTag(publicPlayerTag(userId), "max");
  revalidateTag(PUBLIC_HOME_TAG, "max");
  revalidatePublicStatsTag("identity");
}

export function updatePublicPlayerTag(userId: string): void {
  updateTag(publicPlayerTag(userId));
  updatePublicHomeTag();
  updatePublicStatsTag("identity");
}

/** Includes removals and identity corrections; never serve a stale statistical attribution. */
export function updatePublicStatsTag(reason: StatsInvalidationReason = "season_or_other"): void {
  recordStatsInvalidation(reason, "attempted");
  try { updateTag(PUBLIC_STATS_TAG); recordStatsInvalidation(reason, "completed"); }
  catch (error) { recordStatsInvalidation(reason, "failed"); throw error; }
}

/** Route/webhook equivalent of updateTag, which is only legal inside Server Actions. */
export function revalidatePublicStatsTag(reason: StatsInvalidationReason = "season_or_other"): void {
  recordStatsInvalidation(reason, "attempted");
  try { revalidateTag(PUBLIC_STATS_TAG, { expire: 0 }); recordStatsInvalidation(reason, "completed"); }
  catch (error) { recordStatsInvalidation(reason, "failed"); throw error; }
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

/** Postcommit BP-only path. Unknown/finished facts retain the global safety invalidation. */
export function revalidateVetoRoomPaths(
  context: { slug: string; seasonId: string; matchId: string; matchStatus: string },
  receipt: { changed: boolean; affectedFacts?: readonly string[] },
  options: RevalidationOptions = {},
): void {
  if (!receipt.changed) return;
  const facts = receipt.affectedFacts;
  // Legacy veto receipts also include map-plan completion/rebuild. Those maps
  // feed warm statistics selection/options even before a match is finished.
  // Only the canonical veto_step fact proves that no map-plan rewrite occurred;
  // legacy veto/map_plan and unknown facts always retain the broad safety tag.
  const nonHistorical = (context.matchStatus === "scheduled" || context.matchStatus === "in_progress")
    && Array.isArray(facts) && facts.length > 0 && facts.every(fact => ["lineups", "appeals", "veto_step"].includes(fact));
  revalidateMatchPaths(context.slug, context.matchId, {
    mode: options.mode,
    statisticsReason: options.statisticsReason ?? "veto",
    // statistics:true is the explicit emergency fallback; never bypass unknown facts.
    statistics: !nonHistorical || options.statistics === true,
  });
  // The public BET snapshot includes live BP support/market facts. Unlike the
  // generic route SWR tags this must expire before the next authoritative read.
  if (options.mode === "route") revalidateTag(publicBetTag(context.seasonId), { expire: 0 });
  else updateTag(publicBetTag(context.seasonId));
}
