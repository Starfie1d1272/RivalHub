import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { captainVotes, seasonRegistrations } from "@/db/schema";
import { CaptainVotingPanel } from "@/components/captains/CaptainVotingPanel";
import { PageLayout, Panel } from "@/components/rivalhub";
import {
  getPublicCaptainVotingData,
  type CaptainVoteRecord,
  type PublicCaptainVoter,
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
  await connection();
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

  const [data, session] = await Promise.all([
    getPublicCaptainVotingData(season.id),
    getUserSession(),
  ]);

  let currentVoter: PublicCaptainVoter | null = null;
  let currentVotes: CaptainVoteRecord[] = [];

  if (session) {
    const reg = await db.query.seasonRegistrations.findFirst({
      where: and(
        eq(seasonRegistrations.userId, session.userId),
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.status, "approved"),
      ),
      columns: { id: true },
    });
    if (reg) {
      currentVoter = data.voters.find((v) => v.id === reg.id) ?? null;
      currentVotes = await db
        .select({
          voterRegistrationId: captainVotes.voterRegistrationId,
          candidateRegistrationId: captainVotes.candidateRegistrationId,
        })
        .from(captainVotes)
        .where(eq(captainVotes.voterRegistrationId, reg.id));
    }
  }

  return (
    <PageLayout variant="wide" className="space-y-8">
      <div className="mb-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)] uppercase mb-1">
          {season.name} · CAPTAINS
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">{season.status === "voting" ? "队长投票" : "队长投票结果"}</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
          {season.status === "voting" ? "实时票数" : "查看票数与选秀回顾"}
        </p>
      </div>

      <CaptainVotingPanel
        seasonName={season.name}
        seasonStatus={season.status}
        currentVoter={currentVoter}
        candidates={data.candidates}
        votes={currentVotes}
      />
    </PageLayout>
  );
}
