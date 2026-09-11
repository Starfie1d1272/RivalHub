import type { Announcement } from "@/db/schema";

export const ANNOUNCEMENT_TYPE_LABELS = {
  notice: "通知",
  product_update: "功能更新",
  important_alert: "重要提醒",
} as const;

export const ANNOUNCEMENT_STATUS_LABELS = {
  draft: "草稿",
  published: "已发布",
} as const;

export type PublicAnnouncement = {
  id: string;
  scope: "site" | "season";
  scopeLabel: string;
  season: { slug: string; name: string } | null;
  type: Announcement["type"];
  typeLabel: string;
  title: string;
  body: string;
  publishedAt: string;
  updatedAt: string;
  requiresAttention: boolean;
  attentionUntil: string | null;
};

type AnnouncementWithSeason = Pick<Announcement,
  "id" | "scope" | "type" | "title" | "body" | "publishedAt" | "updatedAt" | "requiresAttention" | "attentionUntil"
> & { season?: { slug: string; name: string } | null };

export function announcementTypeLabel(type: Announcement["type"]): string {
  return ANNOUNCEMENT_TYPE_LABELS[type];
}

export function announcementStatusLabel(status: Announcement["status"]): string {
  return ANNOUNCEMENT_STATUS_LABELS[status];
}

export function isAnnouncementAttentionEligible(
  announcement: Pick<Announcement, "status" | "requiresAttention" | "attentionUntil">,
  now = new Date(),
): boolean {
  return announcement.status === "published"
    && announcement.requiresAttention
    && (!announcement.attentionUntil || announcement.attentionUntil.getTime() > now.getTime());
}

export function toPublicAnnouncement(row: AnnouncementWithSeason): PublicAnnouncement {
  if (!row.publishedAt) throw new Error("Published announcement is missing publishedAt");
  return {
    id: row.id,
    scope: row.scope,
    scopeLabel: row.scope === "site" ? "全站" : row.season?.name ?? "赛事公告",
    season: row.season ? { slug: row.season.slug, name: row.season.name } : null,
    type: row.type,
    typeLabel: announcementTypeLabel(row.type),
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    requiresAttention: row.requiresAttention,
    attentionUntil: row.attentionUntil?.toISOString() ?? null,
  };
}

export function selectLatestAnnouncement<T extends { publishedAt: Date | null; updatedAt: Date; id: string }>(rows: readonly T[]): T | null {
  return [...rows].sort((a, b) => {
    const published = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    if (published !== 0) return published;
    const updated = b.updatedAt.getTime() - a.updatedAt.getTime();
    return updated !== 0 ? updated : b.id.localeCompare(a.id);
  })[0] ?? null;
}

export function selectAttentionAnnouncement<T extends {
  scope: "site" | "season";
  status: "draft" | "published";
  requiresAttention: boolean;
  attentionUntil: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  id: string;
}>(rows: readonly T[], seasonId?: string): T | null {
  const now = new Date();
  return [...rows]
    .filter((row) => isAnnouncementAttentionEligible(row, now))
    .sort((a, b) => {
      const aPriority = seasonId && a.scope === "season" ? 0 : a.scope === "site" ? 1 : 2;
      const bPriority = seasonId && b.scope === "season" ? 0 : b.scope === "site" ? 1 : 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
        || b.updatedAt.getTime() - a.updatedAt.getTime()
        || b.id.localeCompare(a.id);
    })[0] ?? null;
}
