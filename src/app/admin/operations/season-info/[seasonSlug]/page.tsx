import { notFound } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { SeasonPublicInfoManager } from "@/components/admin/SeasonPublicInfoManager";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getSeasonPublicInfoAdmin } from "@/lib/season-public-info/read-model";

export default async function SeasonInfoAdminDetailPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  const data = await getSeasonPublicInfoAdmin(await params.then((value) => value.seasonSlug), admin.role === "super_admin" ? "super_admin" : "season_admin", admin.seasonIds);
  if (!data) notFound();
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title={`赛事信息 · ${data.season.name}`} description="公开内容只来自显式维护的赛事运营信息。" /><SeasonPublicInfoManager data={data} /></PageLayout>;
}
