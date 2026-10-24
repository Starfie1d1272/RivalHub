import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { fetchAuditLogs } from "@/actions/audit";
import { ErrorState, PageHeader } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AuditLogTable } from "@/components/admin/AuditLogTable";

export default async function SeasonAuditLogPage({ params, searchParams }: {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ page?: string; action?: string; actor?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug), columns: { id: true, name: true } });
  if (!season) notFound();
  if (!(await resolveAdminPageAccess(() => requireSeasonAdmin(season.id)))) {
    return <AdminAccessDenied />;
  }
  const query = await searchParams;
  const result = await fetchAuditLogs({
    seasonScopeId: season.id, pageSize: 50, page: Number(query.page),
    action: query.action, actorId: query.actor, dateFrom: query.dateFrom, dateTo: query.dateTo,
  });
  if (!result.success) {
    return (
      <div className="min-w-0 space-y-5">
        <PageHeader title="赛事日志 / 操作记录" eyebrow={season.name} />
        <ErrorState code={result.error.code} title="无法加载赛事操作日志" sub={result.error.message} />
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title="赛事日志 / 操作记录" eyebrow={season.name} />
      <AuditLogTable
        initialLogs={result.data.logs}
        initialTotal={result.data.total}
        seasons={[season]}
        routeBase={`/admin/${seasonSlug}/logs`}
        seasonScopeId={season.id}
      />
    </div>
  );
}
