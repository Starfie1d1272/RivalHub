import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { CaptainVotingPanel } from "@/components/captains/CaptainVotingPanel";
import { Card } from "@/components/ui/card";
import { getCaptainVotingData } from "@/lib/captains/data";

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
        <Card className="p-8">
          <h1 className="text-2xl font-bold">队长投票 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            该赛季未启用队长投票。
          </p>
        </Card>
      </main>
    );
  }

  const data = await getCaptainVotingData(season.id);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">队长投票 · {season.name}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          公开票数与当前前 8 会定时刷新；赛季进入 drafting 后本页保留最终结果。
        </p>
      </div>

      <CaptainVotingPanel
        seasonName={season.name}
        seasonStatus={season.status}
        voters={data.voters}
        candidates={data.candidates}
        votes={data.votes}
      />
    </main>
  );
}
