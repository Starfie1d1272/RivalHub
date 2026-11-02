import { findAdminSeasonBySlug } from "@/lib/admin/season-context";
import { notFound } from "next/navigation";
import type { Metadata } from "next";


import { PageHeader } from "@/components/rivalhub";
import { DraftAdminPanel } from "@/components/draft/DraftAdminPanel";
import { getFormedCompetitionEntryCount } from "@/lib/competition-entries/counts";
import { getDraftAdminData } from "@/lib/draft/data";
import { getManualFormationData } from "@/lib/draft/manual-data";
import { ManualFormationPanel } from "@/components/draft/ManualFormationPanel";
import { decodeSeasonRules } from "@/lib/seasons/rules";

interface AdminDraftPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: AdminDraftPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  return { title: `选秀管理 · ${seasonSlug}` };
}

export default async function AdminDraftPage({ params }: AdminDraftPageProps) {
  const { seasonSlug } = await params;
  const season = await findAdminSeasonBySlug(seasonSlug);
  if (!season) notFound();

  if (!season.hasDraft && season.registrationMode === "solo") {
    const data = await getManualFormationData(season.id);
    return <div className="space-y-6"><PageHeader title={`管理员编队 · ${season.name}`} description="为已审核的个人报名选手创建编队草稿。" /><ManualFormationPanel seasonId={season.id} data={data} maxTeamSize={season.maxTeamSize} starterCount={season.starterCount} /></div>;
  }

  const [teamCount, data] = await Promise.all([
    getFormedCompetitionEntryCount(season.id),
    season.hasDraft ? getDraftAdminData(season.id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={`选秀管理 · ${season.name}`} description="启动、暂停、恢复选秀流程。选秀开始后选手可围观实时进度。" />

      {season.hasDraft && !season.hasCaptainVoting && decodeSeasonRules(season).source === "policy_v2" && !data?.state && <ManualFormationPanel seasonId={season.id} data={await getManualFormationData(season.id)} maxTeamSize={season.maxTeamSize} starterCount={season.starterCount} captainsOnly />}

      <DraftAdminPanel
        seasonId={season.id}
        seasonName={season.name}
        seasonStatus={season.status}
        teamCount={teamCount}
        data={data}
      />
    </div>
  );
}
