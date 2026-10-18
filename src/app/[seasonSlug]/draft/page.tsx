import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries } from "@/db/schema";
import { DraftLiveRoom } from "@/components/draft/DraftLiveRoom";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { getPublicDraftData } from "@/lib/draft/data";
import { getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

interface DraftPageProps { params: Promise<{ seasonSlug: string }> }
export default function DraftPage(props: DraftPageProps) {
  return <Suspense fallback={<PageLayout variant="workbench"><p role="status">正在加载选秀…</p></PageLayout>}><DraftContent {...props} /></Suspense>;
}
async function DraftContent({ params }: DraftPageProps) {
  await connection();
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const archive = ["playing", "finished", "archived"].includes(season.status);
  if (!season.hasDraft || (!archive && season.status !== "drafting")) {
    return <PageLayout variant="standard"><PageHeader title="选秀" description={season.hasDraft ? "选秀尚未开放" : "本届赛事未启用选秀"} /></PageLayout>;
  }
  const data = await getPublicDraftData(season.id);
  const complete = data.maxPicks > 0 && data.totalPicks >= data.maxPicks;
  const paused = Boolean(data.state && !data.state.isActive && !complete);
  const mode = archive ? "archive" : !data.state ? "preview" : "live";
  return <PageLayout variant="workbench" className="space-y-6">
    <PageHeader title={archive ? "选秀回顾" : complete ? "选秀完成" : mode === "preview" ? "选秀预览" : paused ? "选秀已暂停" : "选秀直播间"} eyebrow={season.name} description={archive ? "最终阵容与完整选人记录" : complete ? "完整阵容与选人记录" : mode === "preview" ? "浏览队伍与选手池" : paused ? "浏览阵容，等待选秀恢复" : "阵容与选人进度实时更新"} actions={!archive && !complete && <Suspense fallback={null}><CaptainEntry seasonId={season.id} slug={seasonSlug} /></Suspense>} />
    <DraftLiveRoom data={data} seasonPositions={season.positions} mode={mode} readonly={mode !== "live"} />
  </PageLayout>;
}
async function CaptainEntry({ seasonId, slug }: { seasonId: string; slug: string }) {
  const session = await getUserSession();
  if (!session) return null;
  const entry = await db.query.competitionEntries.findFirst({ where: and(eq(competitionEntries.competitionId, seasonId), eq(competitionEntries.representativeUserId, session.userId)), columns: { id: true } });
  return entry ? <Button size="sm" variant="outline" asChild><Link href={`/${slug}/draft/captain`}>队长选人 →</Link></Button> : null;
}
