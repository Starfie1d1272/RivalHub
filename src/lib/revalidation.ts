import { revalidatePath, revalidateTag, updateTag } from "next/cache";

import {
  PUBLIC_ANNOUNCEMENTS_TAG,
  PUBLIC_HOME_TAG,
  PUBLIC_SEASON_CATALOG_TAG,
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

/** Server Action semantics: invalidate immediately for read-your-own-writes. */
export function updatePublicSeasonTags(slug: string, seasonId?: string): void {
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
export function revalidatePublicSeasonTags(slug: string, seasonId?: string): void {
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
}

export function updatePublicPlayerTag(userId: string): void {
  updateTag(publicPlayerTag(userId));
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
    revalidatePath(seasonPages[page](slug));
  }
}

export function revalidateMatchPaths(
  slug: string,
  matchId: string,
  options: { mode?: RevalidationMode } = {},
) {
  revalidateSeasonPaths(slug, ["matches", "adminMatches"], options);
  revalidatePath(`/admin/${slug}/matches/${matchId}`);
  revalidatePath(`/${slug}/matches/${matchId}`);
}
