import { SeasonPublicInfoManager } from "@/components/admin/SeasonPublicInfoManager";
import { PageHeader } from "@/components/rivalhub";
import { loadSeasonContentContext } from "@/lib/admin/season-content";
import { getSeasonPublicInfoAdmin } from "@/lib/season-public-info/read-model";
import { notFound } from "next/navigation";

export default async function SeasonInformationPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { season, admin } = await loadSeasonContentContext((await params).seasonSlug);
  const data = await getSeasonPublicInfoAdmin(season.slug, admin.role === "super_admin" ? "super_admin" : "season_admin", admin.seasonIds);
  if (!data) notFound();
  return <div className="space-y-6"><PageHeader title="赛事信息" description="维护本届 Logo、规则入口、交流群与公开联系方式。" /><SeasonPublicInfoManager data={data} /></div>;
}
