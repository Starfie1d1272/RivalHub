import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { fetchAuditLogs, getAuditSeasons } from "@/actions/audit";
import { Marker } from "@/components/rivalhub";
import { AuditLogTable } from "@/components/admin/AuditLogTable";

export const dynamic = "force-dynamic";

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
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

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

  const logs = logsResult.success ? logsResult.data.logs : [];
  const total = logsResult.success ? logsResult.data.total : 0;
  const actorNameMap = logsResult.success ? (logsResult.data.actorNameMap ?? {}) : {};
  const targetNameMap = logsResult.success ? (logsResult.data.targetNameMap ?? {}) : {};
  const seasons = seasonsResult.success ? seasonsResult.data : [];

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Marker>操作日志</Marker>
      <AuditLogTable initialLogs={logs} initialTotal={total} seasons={seasons} initialActorNameMap={actorNameMap} initialTargetNameMap={targetNameMap} />
    </div>
  );
}
