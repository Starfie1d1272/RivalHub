import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { CaptainConfirmPanel } from "@/components/captains/CaptainConfirmPanel";
import { PageHeader, Panel } from "@/components/rivalhub";
import { getPublicCaptainVotingData, getSeasonTeamCount } from "@/lib/captains/data";

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
      <div className="space-y-6">
        <PageHeader title={`队长确认 · ${season.name}`} />
        <Panel contentClassName="p-8">
          <p className="text-sm text-[var(--color-fg-mid)]">
            该赛季未启用队长投票。
          </p>
        </Panel>
      </div>
    );
  }

  const [data, teamCount] = await Promise.all([
    getPublicCaptainVotingData(season.id),
    getSeasonTeamCount(season.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={`队长确认 · ${season.name}`} description="查看票数排序，确认前 8 名后自动生成队伍与 draft order。" />

      <CaptainConfirmPanel
        seasonId={season.id}
        seasonStatus={season.status}
        teamCount={teamCount}
        candidates={data.candidates}
      />
    </div>
  );
}
