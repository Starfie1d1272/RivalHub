import { revalidatePath, revalidateTag, updateTag } from "next/cache";

import {
  PUBLIC_ANNOUNCEMENTS_TAG,
  PUBLIC_HOME_TAG,
  PUBLIC_SEASON_CATALOG_TAG,
  PUBLIC_STATS_TAG,
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
type StatisticsRevalidationOptions = { statistics?: boolean };
type RevalidationOptions = StatisticsRevalidationOptions & { mode?: RevalidationMode };

/** Server Action semantics: invalidate immediately for read-your-own-writes. */
export function updatePublicSeasonTags(
  slug: string,
  seasonId?: string,
  options: StatisticsRevalidationOptions = {},
): void {
  if (options.statistics !== false) updatePublicStatsTag();
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
  if (options.statistics !== false) revalidatePublicStatsTag();
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
  revalidatePublicStatsTag();
}

export function updatePublicPlayerTag(userId: string): void {
  updateTag(publicPlayerTag(userId));
  updatePublicStatsTag();
}

/** Includes removals and identity corrections; never serve a stale statistical attribution. */
export function updatePublicStatsTag(): void {
  updateTag(PUBLIC_STATS_TAG);
}

/** Route/webhook equivalent of updateTag, which is only legal inside Server Actions. */
export function revalidatePublicStatsTag(): void {
  revalidateTag(PUBLIC_STATS_TAG, { expire: 0 });
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
