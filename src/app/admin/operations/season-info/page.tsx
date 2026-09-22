import Link from "next/link";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { listSeasonPublicInfoAdmin } from "@/lib/season-public-info/read-model";

export default async function SeasonInfoAdminPage() {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  const rows = await listSeasonPublicInfoAdmin(admin.role === "super_admin" ? "super_admin" : "season_admin", admin.seasonIds);
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="赛事信息" description="维护规则入口、交流群与明确公开的联系方式。" /><div className="grid gap-3">{rows.length === 0 ? <Panel><p className="text-sm text-[var(--color-fg-mid)]">暂无可管理的赛事。</p></Panel> : rows.map(({ season, groups, contacts }) => <Link key={season.id} href={`/admin/operations/season-info/${season.slug}`} className="block"><Panel hoverable><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-[var(--color-fg)]">{season.name}</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{groups.length} 个交流群 · {contacts.length} 条联系方式</p></div><span className="text-sm text-[var(--color-accent)]">编辑 →</span></div></Panel></Link>)}</div></PageLayout>;
}
