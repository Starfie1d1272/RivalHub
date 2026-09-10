import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { fetchAuditLogs, getAuditSeasons } from "@/actions/audit";
import { ErrorState, PageHeader, PageLayout } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AuditLogTable } from "@/components/admin/AuditLogTable";

interface AdminLogsPageProps {
  searchParams: Promise<{
    page?: string;
    action?: string;
    actor?: string;
    seasonId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}

export default async function AdminLogsPage({ searchParams }: AdminLogsPageProps) {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;

  const params = await searchParams;
  const [logsResult, seasonsResult] = await Promise.all([
    fetchAuditLogs({
      page: params.page ? Number(params.page) : undefined,
      pageSize: 50,
      action: params.action,
      actorId: params.actor,
      seasonId: params.seasonId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
    getAuditSeasons(),
  ]);

  if (!logsResult.success) {
    return (
      <PageLayout variant="wide" className="space-y-6">
        <PageHeader title="操作日志" />
        <ErrorState code={logsResult.error.code} title="无法加载操作日志" sub={logsResult.error.message} />
      </PageLayout>
    );
  }
  if (!seasonsResult.success) {
    return (
      <PageLayout variant="wide" className="space-y-6">
        <PageHeader title="操作日志" />
        <ErrorState code={seasonsResult.error.code} title="无法加载赛季筛选项" sub={seasonsResult.error.message} />
      </PageLayout>
    );
  }

  return (
    <PageLayout variant="wide" className="space-y-6">
      <PageHeader title="操作日志" />
      <AuditLogTable initialLogs={logsResult.data.logs} initialTotal={logsResult.data.total} seasons={seasonsResult.data} />
    </PageLayout>
  );
}
