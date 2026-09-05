import { notFound } from "next/navigation";
import { SeasonWorkspaceOverview } from "@/components/admin/SeasonWorkspaceOverview";
import { loadSeasonWorkspaceOverview } from "@/lib/admin/season-workspace";

export default async function AdminSeasonOverviewPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const data = await loadSeasonWorkspaceOverview(seasonSlug);
  if (!data) notFound();

  return <SeasonWorkspaceOverview data={data} />;
}
