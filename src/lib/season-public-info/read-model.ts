import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { communityGroups, seasonContacts, seasonPublicInfo, seasons, type CommunityGroup, type SeasonContact, type SeasonPublicInfo } from "@/db/schema";
import { toPublicSeasonInfo, type PublicSeasonInfo } from "./presentation";

export type SeasonPublicInfoAdmin = {
  season: { id: string; slug: string; name: string };
  info: SeasonPublicInfo | null;
  groups: CommunityGroup[];
  contacts: SeasonContact[];
};

export async function getPublicSeasonInfo(seasonId: string): Promise<PublicSeasonInfo> {
  const [info] = await db.select().from(seasonPublicInfo).where(eq(seasonPublicInfo.seasonId, seasonId)).limit(1);
  const groups = await db.select().from(communityGroups).where(eq(communityGroups.seasonId, seasonId)).orderBy(asc(communityGroups.sortOrder), asc(communityGroups.createdAt), asc(communityGroups.id));
  const contacts = await db.select().from(seasonContacts).where(eq(seasonContacts.seasonId, seasonId)).orderBy(asc(seasonContacts.sortOrder), asc(seasonContacts.createdAt), asc(seasonContacts.id));
  return toPublicSeasonInfo(info ?? null, groups, contacts);
}

export async function getPublicSeasonInfoBySlug(seasonSlug: string): Promise<(PublicSeasonInfo & { season: { id: string; slug: string; name: string } }) | null> {
  const [season] = await db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name }).from(seasons).where(eq(seasons.slug, seasonSlug)).limit(1);
  if (!season) return null;
  return { ...(await getPublicSeasonInfo(season.id)), season };
}

export async function listSeasonPublicInfoAdmin(role: "season_admin" | "super_admin", seasonIds: readonly string[]): Promise<SeasonPublicInfoAdmin[]> {
  const seasonRows = await db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name })
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

export async function getSeasonPublicInfoAdmin(seasonSlug: string, role: "season_admin" | "super_admin", seasonIds: readonly string[]): Promise<SeasonPublicInfoAdmin | null> {
  const [season] = await db.select({ id: seasons.id, slug: seasons.slug, name: seasons.name }).from(seasons).where(eq(seasons.slug, seasonSlug)).limit(1);
  if (!season || (role !== "super_admin" && !seasonIds.includes(season.id))) return null;
  const [result] = await listSeasonPublicInfoAdmin(role, [season.id]);
  return result ?? null;
}
