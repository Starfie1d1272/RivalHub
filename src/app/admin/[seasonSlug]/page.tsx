import { ContentReady } from "@/components/telemetry/ContentReady";
import { notFound } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { SeasonWorkspaceOverview } from "@/components/admin/SeasonWorkspaceOverview";
import { resolveAdminSeasonPageAccess } from "@/lib/admin/season-context";
import { loadSeasonWorkspaceOverview } from "@/lib/admin/season-workspace/overview";

export default async function AdminSeasonOverviewPage({
  params,
}: {
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  if (!(await resolveAdminSeasonPageAccess(seasonSlug))) return <AdminAccessDenied />;

  const data = await loadSeasonWorkspaceOverview(seasonSlug);
  if (!data) notFound();

  return (
    <>
      <SeasonWorkspaceOverview data={data} />
      <ContentReady module="admin" phase="primary" />
    </>
  );
}
