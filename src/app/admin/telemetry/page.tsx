import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getTelemetryAnalysis } from "@/lib/telemetry/dashboard";
import {
  analysisDefaults,
  analysisFields,
  parseAnalysisQuery,
} from "@/lib/telemetry/analysis-query";
export default async function TelemetryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const params = await searchParams;
  const query = parseAnalysisQuery(
    Object.fromEntries(
      Object.entries(params).filter(([key]) =>
        (analysisFields as readonly string[]).includes(key),
      ),
    ),
  );
  const result = await getTelemetryAnalysis(query?.filters ?? analysisDefaults);
  if (result.status === "ready")
    return <TelemetryDashboard initial={result.data} />;
  return (
    <PageLayout variant="workbench" className="space-y-6">
      <PageHeader title="遥测分析" />
      <Panel>
        <p>
          {result.status === "unconfigured"
            ? "尚未配置遥测查询"
            : "暂时无法读取遥测分析，请稍后重试。"}
        </p>
      </Panel>
    </PageLayout>
  );
}
