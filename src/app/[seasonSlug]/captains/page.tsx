import { io } from "next/cache";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CaptainVotingPanel } from "@/components/captains/CaptainVotingPanel";
import { PageLayout, Panel } from "@/components/rivalhub";
import {
  getPublicCaptainVotingData,
  getCaptainVotingViewer,
} from "@/lib/captains/data";
import { getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

interface CaptainsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default function CaptainsPage(props: CaptainsPageProps) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status">正在加载投票…</p></PageLayout>}><CaptainsContent {...props} /></Suspense>;
}
async function CaptainsContent({ params }: CaptainsPageProps) {
  await io();
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  if (!season.hasCaptainVoting) {
    return (
      <PageLayout variant="wide">
        <Panel contentClassName="p-8">
          <h1 className="text-2xl font-bold">队长投票 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
            该赛季未启用队长投票。
          </p>
        </Panel>
      </PageLayout>
    );
  }

  const data = await getPublicCaptainVotingData(season.id);

  return (
    <PageLayout variant="wide" className="space-y-8">
      <div className="mb-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)] uppercase mb-1">
          {season.name} · CAPTAINS
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">队长投票</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
          公开票数与当前前 8 会定时刷新；赛季进入 drafting 后本页保留最终结果。
        </p>
      </div>

      {season.status === "voting" && (
        <div className="rounded-sm border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4 text-sm text-[var(--color-fg-mid)]">
          <p className="font-medium text-[var(--color-fg)] mb-1">关于选秀顺序</p>
          <p>
            第一轮选秀将<strong className="text-[var(--color-fg)]">逆向进行</strong>
            ——排位最靠后的队伍最先选人，依次轮到排位靠前的队伍。
            请根据候选人的<strong className="text-[var(--color-fg)]">实际实力</strong>（而非关系远近）进行投票，
            以确保选秀公平。
          </p>
        </div>
      )}

      <Suspense fallback={<CaptainVotingPanel seasonSlug={season.slug} seasonName={season.name} seasonStatus={season.status}
        currentVoter={null} candidates={data.candidates} votes={[]} viewerPending />}>
        <CaptainViewerPanel season={season} data={data} />
      </Suspense>
    </PageLayout>
  );
}

async function CaptainViewerPanel({ season, data }: {
  season: { id: string; slug: string; name: string; status: string };
  data: Awaited<ReturnType<typeof getPublicCaptainVotingData>>;
}) {
  const session = await getUserSession();
  const viewer = await getCaptainVotingViewer(data, session?.userId ?? null);
  return <CaptainVotingPanel seasonSlug={season.slug} seasonName={season.name} seasonStatus={season.status}
    candidates={data.candidates} currentVoter={viewer.currentVoter} votes={viewer.votes} />;
}
