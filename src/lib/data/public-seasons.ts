import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { and, desc, eq, ne } from "drizzle-orm";

import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import type { Season } from "@/db/schema/seasons";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import {
  PUBLIC_SEASON_CATALOG_TAG,
  publicSeasonTag,
} from "@/lib/cache/tags";

/**
 * Public season data is deliberately selected field-by-field. Keep internal
 * timestamps and future server-only columns out of the RSC/cache contract.
 */
export type PublicSeason = Pick<
  Season,
  | "id"
  | "slug"
  | "name"
  | "kind"
  | "competitionTemplate"
  | "status"
  | "themeColor"
  | "registrationMode"
  | "hasCaptainVoting"
  | "hasDraft"
  | "stagePlan"
  | "registrationConfig"
  | "teamRegistrationConfig"
  | "affiliationRules"
  | "minTeamSize"
  | "maxTeamSize"
  | "starterCount"
  | "positions"
  | "registrationOpensAt"
  | "registrationOpenedAt"
  | "registrationClosesAt"
  | "rosterChangeClosesAt"
  | "endAt"
  | "createdAt"
>;

const publicSeasonColumns = {
  id: seasons.id,
  slug: seasons.slug,
  name: seasons.name,
  kind: seasons.kind,
  competitionTemplate: seasons.competitionTemplate,
  status: seasons.status,
  themeColor: seasons.themeColor,
  registrationMode: seasons.registrationMode,
  hasCaptainVoting: seasons.hasCaptainVoting,
  hasDraft: seasons.hasDraft,
  stagePlan: seasons.stagePlan,
  registrationConfig: seasons.registrationConfig,
  teamRegistrationConfig: seasons.teamRegistrationConfig,
  affiliationRules: seasons.affiliationRules,
  minTeamSize: seasons.minTeamSize,
  maxTeamSize: seasons.maxTeamSize,
  starterCount: seasons.starterCount,
  positions: seasons.positions,
  registrationOpensAt: seasons.registrationOpensAt,
  registrationOpenedAt: seasons.registrationOpenedAt,
  registrationClosesAt: seasons.registrationClosesAt,
  rosterChangeClosesAt: seasons.rosterChangeClosesAt,
  endAt: seasons.endAt,
  createdAt: seasons.createdAt,
} as const;

/**
 * The initial profile intentionally expires before prerendering. This keeps
 * production builds independent from a remote database; the first request
 * fills the public cache and subsequent requests reuse its tagged value.
 */
const PUBLIC_CACHE_LIFE = "seconds" as const;

export async function getPublicSeasonCatalog(): Promise<PublicSeason[]> {
  "use cache";
  cacheLife(PUBLIC_CACHE_LIFE);
  cacheTag(PUBLIC_SEASON_CATALOG_TAG);

  return db
    .select(publicSeasonColumns)
    .from(seasons)
    .where(ne(seasons.status, "draft"))
    .orderBy(desc(seasons.createdAt));
}

export async function getPublicSeasonBySlug(slug: string): Promise<PublicSeason | null> {
  "use cache";
  cacheLife(PUBLIC_CACHE_LIFE);
  cacheTag(PUBLIC_SEASON_CATALOG_TAG, publicSeasonTag(slug));

  const [season] = await db
    .select(publicSeasonColumns)
    .from(seasons)
    .where(and(eq(seasons.slug, slug), ne(seasons.status, "draft")))
    .limit(1);

  return season ?? null;
}

/**
 * Public lookup is the fast path. A draft is only looked up uncached and
 * returned after the existing server-side authorization owner approves it.
 */
export async function getPublicOrAuthorizedDraftSeason(
  slug: string,
): Promise<PublicSeason | null> {
  const publicSeason = await getPublicSeasonBySlug(slug);
  if (publicSeason) return publicSeason;

  const authorization = await getCurrentUserAuthorization();
  if (!authorization) return null;

  const [draftSeason] = await db
    .select(publicSeasonColumns)
    .from(seasons)
    .where(and(eq(seasons.slug, slug), eq(seasons.status, "draft")))
    .limit(1);

  if (
    !draftSeason ||
    (authorization.role !== "super_admin" &&
      !authorization.seasonIds.includes(draftSeason.id))
  ) {
    return null;
  }

  return draftSeason;
}
