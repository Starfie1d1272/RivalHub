import { resolveAdminSeasonPageAccess } from "@/lib/admin/season-context";
import type { Metadata } from "next";

import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PageHeader } from "@/components/rivalhub";
import { DraftAdminPanel } from "@/components/draft/DraftAdminPanel";
import { getFormedCompetitionEntryCount } from "@/lib/competition-entries/counts";
import { getDraftAdminData } from "@/lib/draft/data";

interface AdminDraftPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: AdminDraftPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  return { title: `选秀管理 · ${seasonSlug}` };
}

export default async function AdminDraftPage({ params }: AdminDraftPageProps) {
  const { seasonSlug } = await params;
  const season = await resolveAdminSeasonPageAccess(seasonSlug);
  if (!season) return <AdminAccessDenied />;

  const [teamCount, data] = await Promise.all([
    getFormedCompetitionEntryCount(season.id),
    season.hasDraft ? getDraftAdminData(season.id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`选秀管理 · ${season.name}`}
        description="启动、暂停、恢复选秀流程。选秀开始后选手可围观实时进度。"
      />

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
