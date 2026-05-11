import { revalidatePath } from "next/cache";

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

export function revalidateSeasonPaths(slug: string, pages: SeasonPage[]) {
  for (const page of pages) {
    revalidatePath(seasonPages[page](slug));
  }
}

export function revalidateMatchPaths(slug: string, matchId: string) {
  revalidateSeasonPaths(slug, ["matches", "adminMatches"]);
  revalidatePath(`/${slug}/matches/${matchId}`);
}
