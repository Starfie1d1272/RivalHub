import { asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { AnnouncementManager } from "@/components/admin/AnnouncementManager";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { listAnnouncementsForAdmin } from "@/lib/announcements/read-model";
import type { Announcement } from "@/db/schema";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): Announcement["status"] | undefined {
  return value === "draft" || value === "published" ? value : undefined;
}

function parseScope(value: string | undefined): Announcement["scope"] | undefined {
  return value === "site" || value === "season" ? value : undefined;
}

export default async function AnnouncementsAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  const role = admin.role === "super_admin" ? "super_admin" as const : "season_admin" as const;
  const params = await searchParams;
  const status = parseStatus(first(params.status));
  const scope = parseScope(first(params.scope));
  const [rows, seasonRows] = await Promise.all([
    listAnnouncementsForAdmin({ role, seasonIds: admin.seasonIds, status, scope }),
    db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(role === "super_admin" ? undefined : admin.seasonIds.length ? inArray(seasons.id, admin.seasonIds) : inArray(seasons.id, [] as string[])).orderBy(asc(seasons.name)),
  ]);
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="公告" description="管理全站与赛事公告；发布前先确认范围和主动提醒语义。" /><AnnouncementManager rows={rows} seasons={seasonRows} canManageSite={role === "super_admin"} /></PageLayout>;
}
