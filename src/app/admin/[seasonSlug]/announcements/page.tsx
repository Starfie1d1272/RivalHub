import { AnnouncementManager } from "@/components/admin/AnnouncementManager";
import { PageHeader } from "@/components/rivalhub";
import { loadSeasonContentContext } from "@/lib/admin/season-content";
import { loadAdminAnnouncementPage } from "@/lib/admin/announcement-page";

export default async function SeasonAnnouncementsPage({ params, searchParams }: {
  params: Promise<{ seasonSlug: string }>; searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { season, admin } = await loadSeasonContentContext((await params).seasonSlug);
  const { status, page } = await searchParams;
  const result = await loadAdminAnnouncementPage({ page, role: admin.role === "super_admin" ? "super_admin" : "season_admin", seasonIds: admin.seasonIds, seasonId: season.id, scope: "season", status: status === "draft" || status === "published" ? status : undefined });
  return <div className="space-y-6"><PageHeader title="本届公告" description={`发布与维护 ${season.name} 的通知。`} /><AnnouncementManager rows={result.items} total={result.total} page={result.page} pageSize={result.pageSize} seasons={[season]} canManageSite={false} seasonScoped routeBase={`/admin/${season.slug}/announcements`} /></div>;
}
