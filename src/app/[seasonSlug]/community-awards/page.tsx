import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { PublicCommunityAwards } from "@/components/community-awards/PublicCommunityAwards";
import { PageLayout } from "@/components/rivalhub";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { getPublicCommunityAwardBoardData } from "@/lib/community-awards/data";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

export default async function CommunityAwardsPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  if (!season.hasCommunityAwards) notFound();
  const authorization = await getCurrentUserAuthorization();
  const data = await getPublicCommunityAwardBoardData(db, { seasonId: season.id, currentUserId: authorization?.userId ?? null, stagePlan: normalizeStagePlan(season.stagePlan) });
  return <PageLayout variant="narrow" className="space-y-6"><div><h1 className="text-2xl font-bold">社区奖 · {season.name}</h1><p className="mt-1 text-sm text-[var(--color-fg-mid)]">社区提出创意，赛事方审核与确认结果；不替代正式赛事荣誉。</p></div><PublicCommunityAwards seasonId={season.id} awards={data.awards} currentUserId={authorization?.userId ?? null} candidates={data.candidates} matches={data.matches} /></PageLayout>;
}
