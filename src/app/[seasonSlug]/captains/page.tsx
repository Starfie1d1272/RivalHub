import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonRegistrations, seasons } from "@/db/schema";
import { CaptainVotingPanel } from "@/components/captains/CaptainVotingPanel";
import { Panel } from "@/components/rivalhub";
import { getCaptainVotingData } from "@/lib/captains/data";
import { getUserSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface CaptainsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function CaptainsPage({ params }: CaptainsPageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (!season.hasCaptainVoting) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <Panel pad={32}>
          <h1 className="text-2xl font-bold">队长投票 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
            该赛季未启用队长投票。
          </p>
        </Panel>
      </main>
    );
  }

  const [data, session] = await Promise.all([
    getCaptainVotingData(season.id),
    getUserSession(),
  ]);

  let currentVoter = data.voters.find(() => false) ?? null; // typed as CaptainVoterOption | null
  let currentVotes = data.votes.filter(() => false);

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
      currentVotes = data.votes.filter((v) => v.voterRegistrationId === reg.id);
    }
  }

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
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
        <div className="mb-6 rounded-sm border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4 text-sm text-[var(--color-fg-mid)]">
          <p className="font-medium text-[var(--color-fg)] mb-1">关于选秀顺序</p>
          <p>
            第一轮选秀将<strong className="text-[var(--color-fg)]">逆向进行</strong>
            ——排位最靠后的队伍最先选人，依次轮到排位靠前的队伍。
            请根据候选人的<strong className="text-[var(--color-fg)]">实际实力</strong>（而非关系远近）进行投票，
            以确保选秀公平。
          </p>
        </div>
      )}

      <CaptainVotingPanel
        seasonName={season.name}
        seasonStatus={season.status}
        currentVoter={currentVoter}
        candidates={data.candidates}
        votes={currentVotes}
      />
    </main>
  );
}
