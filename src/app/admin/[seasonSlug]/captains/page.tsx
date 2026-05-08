import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { CaptainConfirmPanel } from "@/components/captains/CaptainConfirmPanel";
import { Card } from "@/components/ui/card";
import { getCaptainVotingData, getSeasonTeamCount } from "@/lib/captains/data";

export const dynamic = "force-dynamic";

interface AdminCaptainsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminCaptainsPage({ params }: AdminCaptainsPageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (!season.hasCaptainVoting) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-8">
        <Card className="p-8">
          <h1 className="text-2xl font-bold">队长确认 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            该赛季未启用队长投票。
          </p>
        </Card>
      </main>
    );
  }

  const [data, teamCount] = await Promise.all([
    getCaptainVotingData(season.id),
    getSeasonTeamCount(season.id),
  ]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">队长确认 · {season.name}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          查看票数排序，确认前 8 名后自动生成队伍与 draft order。
        </p>
      </div>

      <CaptainConfirmPanel
        seasonId={season.id}
        seasonStatus={season.status}
        teamCount={teamCount}
        candidates={data.candidates}
      />
    </main>
  );
}
