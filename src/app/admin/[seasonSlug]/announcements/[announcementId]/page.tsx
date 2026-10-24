import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { PageHeader } from "@/components/rivalhub";
import { loadSeasonContentContext } from "@/lib/admin/season-content";
import { getAnnouncementForAdmin } from "@/lib/announcements/read-model";

export default async function EditSeasonAnnouncementPage({ params }: { params: Promise<{ seasonSlug: string; announcementId: string }> }) {
  const { seasonSlug, announcementId } = await params;
  const { season, admin } = await loadSeasonContentContext(seasonSlug);
  const row = await getAnnouncementForAdmin(announcementId, { role: admin.role === "super_admin" ? "super_admin" : "season_admin", seasonIds: admin.seasonIds, seasonId: season.id, scope: "season" });
  if (!row || row.seasonId !== season.id) notFound();
  return <div className="space-y-6"><PageHeader title="编辑本届公告" description={season.name} /><AnnouncementForm initialData={row} announcementId={row.id} isEditing seasons={[season]} canManageSite={false} returnHref={`/admin/${season.slug}/announcements`} /></div>;
}
