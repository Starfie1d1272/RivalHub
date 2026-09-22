import { notFound } from "next/navigation";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { SeasonPublicInfoView } from "@/components/season/SeasonPublicInfoView";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getPublicSeasonInfo } from "@/lib/season-public-info/read-model";

export default async function SeasonInfoPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const info = await getPublicSeasonInfo(season.id);
  return <PageLayout variant="wide" className="space-y-6"><PageHeader title={`赛事信息 · ${season.name}`} description="规则入口、交流群与公开联系方式。" /><SeasonPublicInfoView info={info} /></PageLayout>;
}
