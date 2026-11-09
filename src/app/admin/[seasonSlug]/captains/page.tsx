import { resolveAdminSeasonPageAccess } from "@/lib/admin/season-context";

import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { CaptainConfirmPanel } from "@/components/captains/CaptainConfirmPanel";
import { PageHeader, Panel } from "@/components/rivalhub";
import { getAdminCaptainRanking, getSeasonTeamCount } from "@/lib/captains/data";
import { CAPTAIN_TEAM_COUNT, getCaptainConfirmationBlocker } from "@/lib/captains/rules";

interface AdminCaptainsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminCaptainsPage({ params }: AdminCaptainsPageProps) {
  const { seasonSlug } = await params;
  const season = await resolveAdminSeasonPageAccess(seasonSlug);
  if (!season) return <AdminAccessDenied />;

  if (!season.hasCaptainVoting) {
    return (
      <div className="space-y-6">
        <PageHeader title={`队长确认 · ${season.name}`} />
        <Panel contentClassName="p-8">
          <p className="text-sm text-[var(--color-fg-mid)]">该赛季未启用队长投票。</p>
        </Panel>
      </div>
    );
  }

  const [data, teamCount] = await Promise.all([
    getAdminCaptainRanking(season.id),
    getSeasonTeamCount(season.id),
  ]);
  const blocker = getCaptainConfirmationBlocker({ season, teamCount, ...data });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`队长确认 · ${season.name}`}
        description={`核对前 ${CAPTAIN_TEAM_COUNT} 名队长及其选秀顺位后生成队伍。`}
      />

      <CaptainConfirmPanel
        seasonId={season.id}
        seasonStatus={season.status}
        teamCount={teamCount}
        candidates={data.seeds}
        candidateCount={data.candidateCount}
        totalVotes={data.totalVotes}
        confirmationBlockedReason={blocker?.message ?? null}
      />
    </div>
  );
}
