import { resolveAdminSeasonPageAccess } from "@/lib/admin/season-context";

import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PostEventManagement } from "@/components/admin/PostEventManagement";
import { SeasonPostEventOverview } from "@/components/admin/SeasonPostEventOverview";
import { PageHeader } from "@/components/rivalhub";
import { loadPostEventPageData } from "@/lib/admin/season-workspace/post-event";

export default async function AdminSeasonPostEventPage({
  params,
}: {
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await resolveAdminSeasonPageAccess(seasonSlug);
  if (!season) return <AdminAccessDenied />;

  const { data, season: postEventSeason } = await loadPostEventPageData(season);
  if (postEventSeason.competitionTemplate !== "major") {
    return <SeasonPostEventOverview data={{ season: postEventSeason, data }} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`赛后 · ${season.name}`}
        description="赛事 closure、官方结果、裁决与荣誉"
      />
      <PostEventManagement data={data} />
    </div>
  );
}
