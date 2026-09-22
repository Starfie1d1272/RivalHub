import { notFound } from "next/navigation";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { AnnouncementList } from "@/components/content/AnnouncementList";
import { listPublicAnnouncements } from "@/lib/announcements/read-model";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

export default async function SeasonAnnouncementsPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title={`${season.name} · 公告`} description="本届赛事已发布公告历史。" /><AnnouncementList announcements={await listPublicAnnouncements(season.id)} /></PageLayout>;
}
