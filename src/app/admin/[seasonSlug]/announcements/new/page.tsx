import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { PageHeader } from "@/components/rivalhub";
import { loadSeasonContentContext } from "@/lib/admin/season-content";

export default async function NewSeasonAnnouncementPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { season } = await loadSeasonContentContext((await params).seasonSlug);
  return <div className="space-y-6"><PageHeader title="新建本届公告" description={season.name} /><AnnouncementForm seasons={[season]} canManageSite={false} returnHref={`/admin/${season.slug}/announcements`} /></div>;
}
