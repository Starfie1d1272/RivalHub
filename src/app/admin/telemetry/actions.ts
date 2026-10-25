"use server";
import { getTelemetryAnalysis } from "@/lib/telemetry/dashboard";
export async function getTelemetryAnalysisAction(input: unknown) {
  return getTelemetryAnalysis(input);
}

export async function getTelemetryComparisonAction(input: unknown, baseline: unknown) {
  const [current, previous] = await Promise.all([getTelemetryAnalysis(input), getTelemetryAnalysis(baseline)]);
  return { current, previous };
}

export async function getTelemetryWorkflowsAction(input: unknown) {
  const { requireSuperAdmin } = await import("@/lib/auth/session");
  await requireSuperAdmin();
  const { WorkflowQuery } = await import("@/lib/admin/product-experience/contract");
  const filters = WorkflowQuery.parse(input);
  const { loadWorkflowMetrics } = await import("@/lib/admin/product-experience/read");
  try { return { status: "ready" as const, data: await loadWorkflowMetrics(filters) }; }
  catch { return { status: "unavailable" as const }; }
}

export async function getTelemetryHistoryAction(input: unknown) {
  const { getTelemetryHistory } = await import("@/lib/telemetry/dashboard");
  return getTelemetryHistory(input);
}
