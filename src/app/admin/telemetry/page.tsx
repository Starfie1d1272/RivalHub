import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { TelemetryLongWindowDashboard } from "@/components/telemetry/TelemetryLongWindowDashboard";
import { analysisSections, isLongWindow, readTaskDefinition, parseUIAnalysisQuery, uiAnalysisDefaults } from "@/components/telemetry/analysis/navigation";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { requireSuperAdmin } from "@/lib/auth/session";
import { loadTelemetryEventNames } from "@/lib/admin/product-experience/read";
import { getTelemetryAnalysis, getLongWindowSummary } from "@/lib/telemetry/dashboard";
import { analysisFields } from "@/lib/telemetry/analysis-query";
export default async function TelemetryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const params = await searchParams;
  if (params.view === "database") {
    const { DatabaseTraffic } = await import("@/components/telemetry/DatabaseTraffic");
    return <DatabaseTraffic hours={params.hours === "24" ? 24 : 72} sort={params.sort === "time" || params.sort === "rows" || params.sort === "queries" ? params.sort : "bytes"} selection={{ hour: typeof params.hour === "string" ? params.hour : undefined, release: typeof params.release === "string" ? params.release : undefined, deployment: typeof params.deployment === "string" ? params.deployment : undefined }} />;
  }
  const query = parseUIAnalysisQuery(
    Object.fromEntries(
      Object.entries(params).filter(([key]) =>
        (analysisFields as readonly string[]).includes(key),
      ),
    ),
  );
  const filters = query?.filters ?? uiAnalysisDefaults;
  const view = analysisSections.find(([key]) => key === params.view)?.[0] ?? "overview";
  const long = isLongWindow(filters) && params.analysisMode !== "bounded";
  const catalogRead = loadTelemetryEventNames().catch(() => ({ rows: [], truncated: false }));
  if (long) {
    const summary = await getLongWindowSummary(filters);
    const catalog = await catalogRead;
    if (summary.status === "ready") return <TelemetryLongWindowDashboard key={JSON.stringify([filters, view])} data={summary.data} filters={filters} events={catalog.rows} view={view} />;
    return <PageLayout variant="workbench"><PageHeader title="产品使用与体验" /><Panel>{summary.status === "unconfigured" ? "尚未配置遥测查询" : "暂时无法读取长窗口汇总，请稍后重试。"}</Panel></PageLayout>;
  }
  const result = await getTelemetryAnalysis(filters);
  if (result.status === "ready") {
    const catalog = await catalogRead;
    return <TelemetryDashboard key={JSON.stringify(filters)} initialView={view} initialTaskDefinition={readTaskDefinition(typeof params.taskDefinition === "string" ? params.taskDefinition : null)} initial={result.data} events={catalog.rows} release={{ sha: process.env.RIVALHUB_RELEASE_COMMIT ?? "", tag: process.env.RIVALHUB_RELEASE_TAG ?? "当前构建" }} />;
  }
  return (
    <PageLayout variant="workbench" className="space-y-6">
      <PageHeader title="产品使用与体验" />
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
