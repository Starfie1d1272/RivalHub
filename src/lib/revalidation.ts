import * as nextCache from "next/cache";

import {
  PUBLIC_SEASON_CATALOG_TAG,
  publicPlayerTag,
  publicSeasonTag,
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

/** Server Action semantics: invalidate immediately for read-your-own-writes. */
export function updatePublicSeasonTags(slug: string, seasonId?: string): void {
  nextCache.updateTag?.(PUBLIC_SEASON_CATALOG_TAG);
  nextCache.updateTag?.(publicSeasonTag(slug));
  if (seasonId) {
    nextCache.updateTag?.(seasonParticipantsTag(seasonId));
    nextCache.updateTag?.(seasonMatchesTag(seasonId));
    nextCache.updateTag?.(seasonStandingsTag(seasonId));
  }
}

/** Route Handler/webhook semantics: stale-while-revalidate the public tags. */
export function revalidatePublicSeasonTags(slug: string, seasonId?: string): void {
  nextCache.revalidateTag?.(PUBLIC_SEASON_CATALOG_TAG, "max");
  nextCache.revalidateTag?.(publicSeasonTag(slug), "max");
  if (seasonId) {
    nextCache.revalidateTag?.(seasonParticipantsTag(seasonId), "max");
    nextCache.revalidateTag?.(seasonMatchesTag(seasonId), "max");
    nextCache.revalidateTag?.(seasonStandingsTag(seasonId), "max");
  }
}

export function updatePublicPlayerTag(userId: string): void {
  nextCache.updateTag?.(publicPlayerTag(userId));
}

export function revalidateSeasonPaths(
  slug: string,
  pages: SeasonPage[],
  options: { mode?: RevalidationMode } = {},
) {
  if (options.mode === "route") {
    revalidatePublicSeasonTags(slug);
  } else {
    updatePublicSeasonTags(slug);
  }
  for (const page of pages) {
    nextCache.revalidatePath(seasonPages[page](slug));
  }
}

export function revalidateMatchPaths(
  slug: string,
  matchId: string,
  options: { mode?: RevalidationMode } = {},
) {
  revalidateSeasonPaths(slug, ["matches", "adminMatches"], options);
  nextCache.revalidatePath(`/admin/${slug}/matches/${matchId}`);
  nextCache.revalidatePath(`/${slug}/matches/${matchId}`);
}
