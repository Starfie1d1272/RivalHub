import "server-only";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements, seasons, type Announcement } from "@/db/schema";
import {
  selectAttentionAnnouncement,
  toPublicAnnouncement,
  type PublicAnnouncement,
} from "./presentation";

export type AnnouncementAdminRow = {
  id: string;
  scope: Announcement["scope"];
  seasonId: string | null;
  seasonName: string | null;
  seasonSlug: string | null;
  type: Announcement["type"];
  title: string;
  body: string;
  status: Announcement["status"];
  requiresAttention: boolean;
  attentionUntil: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PublicRow = {
  announcement: Pick<Announcement,
    "id" | "scope" | "type" | "title" | "body" | "status" | "requiresAttention" | "attentionUntil" | "publishedAt" | "updatedAt"
  >;
  season: { slug: string; name: string } | null;
};

function publicAnnouncementOrder() {
  return [desc(announcements.publishedAt), desc(announcements.updatedAt), desc(announcements.id)];
}

function toPublic(row: PublicRow): PublicAnnouncement {
  return toPublicAnnouncement({ ...row.announcement, season: row.season });
}

export async function listPublicAnnouncements(seasonId?: string): Promise<PublicAnnouncement[]> {
  const rows = await db
    .select({
      announcement: {
        id: announcements.id,
        scope: announcements.scope,
        type: announcements.type,
        title: announcements.title,
        body: announcements.body,
        status: announcements.status,
        requiresAttention: announcements.requiresAttention,
        attentionUntil: announcements.attentionUntil,
        publishedAt: announcements.publishedAt,
        updatedAt: announcements.updatedAt,
      },
      season: { slug: seasons.slug, name: seasons.name },
    })
    .from(announcements)
    .leftJoin(seasons, eq(announcements.seasonId, seasons.id))
    .where(and(
      eq(announcements.status, "published"),
      seasonId ? eq(announcements.seasonId, seasonId) : undefined,
    ))
    .orderBy(...publicAnnouncementOrder());
  return rows.map(toPublic);
}

export async function listAllPublicAnnouncements(): Promise<PublicAnnouncement[]> {
  const rows = await db
    .select({
      announcement: {
        id: announcements.id,
        scope: announcements.scope,
        type: announcements.type,
        title: announcements.title,
        body: announcements.body,
        status: announcements.status,
        requiresAttention: announcements.requiresAttention,
        attentionUntil: announcements.attentionUntil,
        publishedAt: announcements.publishedAt,
        updatedAt: announcements.updatedAt,
      },
      season: { slug: seasons.slug, name: seasons.name },
    })
    .from(announcements)
    .leftJoin(seasons, eq(announcements.seasonId, seasons.id))
    .where(eq(announcements.status, "published"))
    .orderBy(...publicAnnouncementOrder());
  return rows.map(toPublic);
}

export async function getLatestSeasonAnnouncement(seasonId: string): Promise<PublicAnnouncement | null> {
  const rows = await listPublicAnnouncements(seasonId);
  return rows[0] ?? null;
}

export async function getLatestSiteAnnouncement(): Promise<PublicAnnouncement | null> {
  const rows = await db
    .select({
      announcement: {
        id: announcements.id,
        scope: announcements.scope,
        type: announcements.type,
        title: announcements.title,
        body: announcements.body,
        status: announcements.status,
        requiresAttention: announcements.requiresAttention,
        attentionUntil: announcements.attentionUntil,
        publishedAt: announcements.publishedAt,
        updatedAt: announcements.updatedAt,
      },
      season: { slug: seasons.slug, name: seasons.name },
    })
    .from(announcements)
    .leftJoin(seasons, eq(announcements.seasonId, seasons.id))
    .where(and(eq(announcements.status, "published"), eq(announcements.scope, "site"), isNull(announcements.seasonId)))
    .orderBy(...publicAnnouncementOrder())
    .limit(1);
  return rows[0] ? toPublic(rows[0]) : null;
}

export async function getRelevantAnnouncement(seasonId?: string): Promise<PublicAnnouncement | null> {
  if (seasonId) {
    const seasonAnnouncement = await getLatestSeasonAnnouncement(seasonId);
    if (seasonAnnouncement) return seasonAnnouncement;
  }
  return getLatestSiteAnnouncement();
}

export async function getRelevantAttentionAnnouncement(seasonId?: string): Promise<PublicAnnouncement | null> {
  const where = seasonId
    ? and(
        eq(announcements.status, "published"),
        eq(announcements.requiresAttention, true),
        or(eq(announcements.scope, "site"), and(eq(announcements.scope, "season"), eq(announcements.seasonId, seasonId))),
      )
    : and(eq(announcements.status, "published"), eq(announcements.requiresAttention, true), eq(announcements.scope, "site"));
  const rows = await db
    .select({
      announcement: {
        id: announcements.id,
        scope: announcements.scope,
        type: announcements.type,
        title: announcements.title,
        body: announcements.body,
        status: announcements.status,
        requiresAttention: announcements.requiresAttention,
        attentionUntil: announcements.attentionUntil,
        publishedAt: announcements.publishedAt,
        updatedAt: announcements.updatedAt,
      },
      season: { slug: seasons.slug, name: seasons.name },
    })
    .from(announcements)
    .leftJoin(seasons, eq(announcements.seasonId, seasons.id))
    .where(where)
    .orderBy(...publicAnnouncementOrder());
  const selected = selectAttentionAnnouncement(rows.map((row) => ({ ...row.announcement, scope: row.announcement.scope })), seasonId);
  return selected ? toPublic(rows.find((row) => row.announcement.id === selected.id)!) : null;
}

export async function getPublicAnnouncementHistory(seasonId?: string): Promise<PublicAnnouncement[]> {
  return seasonId ? listPublicAnnouncements(seasonId) : listAllPublicAnnouncements();
}

export async function listAnnouncementsForAdmin(input: {
  role: "season_admin" | "super_admin";
  seasonIds: readonly string[];
  status?: Announcement["status"];
  scope?: Announcement["scope"];
}): Promise<AnnouncementAdminRow[]> {
  const conditions = [
    input.status ? eq(announcements.status, input.status) : undefined,
    input.scope ? eq(announcements.scope, input.scope) : undefined,
    input.role === "super_admin" ? undefined : input.seasonIds.length > 0 ? inArray(announcements.seasonId, input.seasonIds) : eq(announcements.id, "00000000-0000-0000-0000-000000000000"),
  ];
  const rows = await db
    .select({
      id: announcements.id,
      scope: announcements.scope,
      seasonId: announcements.seasonId,
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
      type: announcements.type,
      title: announcements.title,
      body: announcements.body,
      status: announcements.status,
      requiresAttention: announcements.requiresAttention,
      attentionUntil: announcements.attentionUntil,
      publishedAt: announcements.publishedAt,
      createdAt: announcements.createdAt,
      updatedAt: announcements.updatedAt,
    })
    .from(announcements)
    .leftJoin(seasons, eq(announcements.seasonId, seasons.id))
    .where(and(...conditions))
    .orderBy(desc(announcements.updatedAt), desc(announcements.id));
  return rows;
}

export async function getAnnouncementForAdmin(id: string, input: { role: "season_admin" | "super_admin"; seasonIds: readonly string[] }): Promise<AnnouncementAdminRow | null> {
  const rows = await listAnnouncementsForAdmin(input);
  return rows.find((row) => row.id === id) ?? null;
}
