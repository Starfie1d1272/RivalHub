import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { publicSeasonInfoTag } from "@/lib/cache/tags";
import { communityGroups, seasonContacts, seasonPublicInfo, seasons, type CommunityGroup, type SeasonContact, type SeasonPublicInfo } from "@/db/schema";
import { toPublicSeasonInfo, type PublicSeasonInfo } from "./presentation";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

export type SeasonPublicInfoAdmin = {
  season: { id: string; slug: string; name: string; logoUrl: string | null };
  info: SeasonPublicInfo | null;
  groups: CommunityGroup[];
  contacts: SeasonContact[];
};

export async function getPublicSeasonInfo(seasonId: string): Promise<PublicSeasonInfo> {
  const publicInfo = await getCachedPublicSeasonInfo(seasonId);
  if (publicInfo) return publicInfo;

  // A cache miss may mean draft, a just-published event, or deletion. Only
  // draft previews require authorization; a deleted event has no DTO.
  const [season] = await db.select({ status: seasons.status, slug: seasons.slug }).from(seasons)
    .where(eq(seasons.id, seasonId)).limit(1);
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES[ErrorCode.SEASON_NOT_FOUND]);
  if (season.status !== "draft") return readSeasonInfo(seasonId, season.slug);

  const viewer = await getCurrentUserAuthorization();
  if (!viewer || (viewer.role !== "super_admin" && !viewer.seasonIds.includes(seasonId))) {
    return toPublicSeasonInfo(null, [], [], season.slug);
  }
  return readSeasonInfo(seasonId, season.slug);
}

async function getCachedPublicSeasonInfo(seasonId: string): Promise<PublicSeasonInfo | null> {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag(publicSeasonInfoTag(seasonId));
  const [season] = await db.select({ slug: seasons.slug, info: { rulesLabel: seasonPublicInfo.rulesLabel, rulesHref: seasonPublicInfo.rulesHref } })
    .from(seasons).leftJoin(seasonPublicInfo, eq(seasonPublicInfo.seasonId, seasons.id))
    .where(and(eq(seasons.id, seasonId), ne(seasons.status, "draft"))).limit(1);
  if (!season) return null;
  return readSeasonInfo(seasonId, season.slug, season.info);
}

async function readSeasonInfo(
  seasonId: string,
  seasonSlug: string,
  publicInfo?: Pick<SeasonPublicInfo, "rulesLabel" | "rulesHref"> | null,
): Promise<PublicSeasonInfo> {
  const info = publicInfo === undefined
    ? (await db.select().from(seasonPublicInfo).where(eq(seasonPublicInfo.seasonId, seasonId)).limit(1))[0] ?? null
    : publicInfo;
  const [groups, contacts] = await Promise.all([
    db.select().from(communityGroups).where(eq(communityGroups.seasonId, seasonId)).orderBy(asc(communityGroups.sortOrder), asc(communityGroups.createdAt), asc(communityGroups.id)),
    db.select().from(seasonContacts).where(eq(seasonContacts.seasonId, seasonId)).orderBy(asc(seasonContacts.sortOrder), asc(seasonContacts.createdAt), asc(seasonContacts.id)),
  ]);
  return toPublicSeasonInfo(info ?? null, groups, contacts, seasonSlug);
}

export async function getPublicSeasonInfoBySlug(seasonSlug: string): Promise<(PublicSeasonInfo & { season: { id: string; slug: string; name: string } }) | null> {
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) return null;
  return { ...(await getPublicSeasonInfo(season.id)), season: { id: season.id, slug: season.slug, name: season.name } };
}

export async function listSeasonPublicInfoAdmin(role: "season_admin" | "super_admin", seasonIds: readonly string[]): Promise<SeasonPublicInfoAdmin[]> {
  const seasonRows = await db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name, logoUrl: seasons.logoUrl })
    .from(seasons)
    .where(role === "super_admin" ? undefined : seasonIds.length ? inArray(seasons.id, seasonIds) : eq(seasons.id, "00000000-0000-0000-0000-000000000000"))
    .orderBy(asc(seasons.name), asc(seasons.id));
  if (!seasonRows.length) return [];
  const ids = seasonRows.map((season) => season.id);
  const [infos, groups, contacts] = await Promise.all([
    db.select().from(seasonPublicInfo).where(inArray(seasonPublicInfo.seasonId, ids)),
    db.select().from(communityGroups).where(inArray(communityGroups.seasonId, ids)).orderBy(asc(communityGroups.sortOrder), asc(communityGroups.createdAt)),
    db.select().from(seasonContacts).where(inArray(seasonContacts.seasonId, ids)).orderBy(asc(seasonContacts.sortOrder), asc(seasonContacts.createdAt)),
  ]);
  return seasonRows.map((season) => ({
    season,
    info: infos.find((info) => info.seasonId === season.id) ?? null,
    groups: groups.filter((group) => group.seasonId === season.id),
    contacts: contacts.filter((contact) => contact.seasonId === season.id),
  }));
}

export async function listSeasonPublicInfoAdminSummaries(role: "season_admin" | "super_admin", seasonIds: readonly string[]) {
  const rows = await db.select({
    season: { id: seasons.id, slug: seasons.slug, name: seasons.name, logoUrl: seasons.logoUrl },
    groupCount: sql<number>`(select count(*)::int from ${communityGroups} admin_group where admin_group.season_id = seasons.id)`,
    contactCount: sql<number>`(select count(*)::int from ${seasonContacts} admin_contact where admin_contact.season_id = seasons.id)`,
  }).from(seasons)
    .where(role === "super_admin" ? undefined : seasonIds.length ? inArray(seasons.id, seasonIds) : eq(seasons.id, "00000000-0000-0000-0000-000000000000"))
    .orderBy(asc(seasons.name), asc(seasons.id));
  return rows;
}

export async function getSeasonPublicInfoAdmin(seasonSlug: string, role: "season_admin" | "super_admin", seasonIds: readonly string[]): Promise<SeasonPublicInfoAdmin | null> {
  const [season] = await db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name, logoUrl: seasons.logoUrl }).from(seasons)
    .where(and(eq(seasons.slug, seasonSlug), role === "super_admin" ? undefined : seasonIds.length ? inArray(seasons.id, seasonIds) : eq(seasons.id, "00000000-0000-0000-0000-000000000000"))).limit(1);
  if (!season) return null;
  const [infos, groups, contacts] = await Promise.all([
    db.select().from(seasonPublicInfo).where(eq(seasonPublicInfo.seasonId, season.id)).limit(1),
    db.select().from(communityGroups).where(eq(communityGroups.seasonId, season.id)).orderBy(asc(communityGroups.sortOrder), asc(communityGroups.createdAt), asc(communityGroups.id)),
    db.select().from(seasonContacts).where(eq(seasonContacts.seasonId, season.id)).orderBy(asc(seasonContacts.sortOrder), asc(seasonContacts.createdAt), asc(seasonContacts.id)),
  ]);
  return { season, info: infos[0] ?? null, groups, contacts };
}
