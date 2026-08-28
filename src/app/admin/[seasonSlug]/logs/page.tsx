import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { fetchAuditLogs } from "@/actions/audit";
import { Marker } from "@/components/rivalhub";
import { AuditLogTable } from "@/components/admin/AuditLogTable";

export const dynamic = "force-dynamic";

export default async function SeasonAuditLogPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug), columns: { id: true, name: true } });
  if (!season) notFound();
  try { await requireSeasonAdmin(season.id); } catch { redirect("/admin/login"); }
  const result = await fetchAuditLogs({ seasonScopeId: season.id, pageSize: 50 });
  const data = result.success ? result.data : { logs: [], total: 0, actorNameMap: {}, targetNameMap: {} };
  return <div className="space-y-5"><Marker sub={season.name}>赛事日志 / 操作记录</Marker><AuditLogTable initialLogs={data.logs} initialTotal={data.total} seasons={[season]} initialActorNameMap={data.actorNameMap ?? {}} initialTargetNameMap={data.targetNameMap ?? {}} routeBase={`/admin/${seasonSlug}/logs`} seasonScopeId={season.id} /></div>;
}
