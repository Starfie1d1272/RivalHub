import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { CaptainConfirmPanel } from "@/components/captains/CaptainConfirmPanel";
import { Panel, Marker } from "@/components/rivalhub";
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
        <Panel pad={32}>
          <Marker>队长确认 · {season.name}</Marker>
          <p className="text-sm text-[var(--color-fg-mid)]">
            该赛季未启用队长投票。
          </p>
        </Panel>
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
        <Marker sub="查看票数排序，确认前 8 名后自动生成队伍与 draft order。">队长确认 · {season.name}</Marker>
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
