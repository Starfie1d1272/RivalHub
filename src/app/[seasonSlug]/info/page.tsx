import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { SeasonPublicInfoView } from "@/components/season/SeasonPublicInfoView";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getPublicSeasonInfo } from "@/lib/season-public-info/read-model";

export default function SeasonInfoPage(props: { params: Promise<{ seasonSlug: string }> }) {
  return <Suspense fallback={<PageLayout variant="narrow"><p role="status">正在加载…</p></PageLayout>}><SeasonInfoPageContent {...props} /></Suspense>;
}
async function SeasonInfoPageContent({ params }: { params: Promise<{ seasonSlug: string }> }) {
  await connection();
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const info = await getPublicSeasonInfo(season.id);
  return <PageLayout variant="wide" className="space-y-6"><PageHeader title={`赛事信息 · ${season.name}`} description="规则入口、交流群与公开联系方式。" /><SeasonPublicInfoView info={info} /></PageLayout>;
}
