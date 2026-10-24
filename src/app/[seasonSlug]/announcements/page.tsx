import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { AnnouncementList } from "@/components/content/AnnouncementList";
import { getPublicAnnouncementPage } from "@/lib/announcements/read-model";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

export default async function SeasonAnnouncementsPage({ params, searchParams }: { params: Promise<{ seasonSlug: string }>; searchParams: Promise<{ page?: string }> }) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const history = await getPublicAnnouncementPage(season.id, Number((await searchParams).page));
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title={`${season.name} · 公告`} description="本届赛事已发布公告历史。" /><AnnouncementList announcements={history.announcements} /><nav aria-label="公告分页" className="flex gap-4">{history.page > 1 && <Link href={`/${seasonSlug}/announcements?page=${history.page - 1}`}>上一页</Link>}{history.hasNext && <Link href={`/${seasonSlug}/announcements?page=${history.page + 1}`}>下一页</Link>}</nav></PageLayout>;
}
