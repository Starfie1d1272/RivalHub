export type ResourceTelemetryMode = "raw" | "summary";
export const RESOURCE_TELEMETRY_VIEWS = 20;
export const resourceTelemetryEndpoint = (mode: ResourceTelemetryMode) => mode === "raw" ? "/admin/analysis" : "/admin/long-window";
export type ResourceTelemetryQuery = { path: string; status: number; bytes: number; views: number | null; coverageStatus: string | null; incompleteSegments: number };

/** Extract safe aggregate facts, never collector response bodies or dimensions. */
export function resourceTelemetryQuery(path: string, status: number, bytes: number, value: unknown): ResourceTelemetryQuery {
  const data = value as { totals?: { views?: unknown }; counts?: { views?: unknown }; coverage?: { status?: unknown; segments?: { status?: unknown }[] } } | null;
  const views = path === "/admin/analysis" ? data?.totals?.views : data?.counts?.views;
  return { path, status, bytes, views: typeof views === "number" && Number.isSafeInteger(views) ? views : null,
    coverageStatus: typeof data?.coverage?.status === "string" ? data.coverage.status : null,
    incompleteSegments: Array.isArray(data?.coverage?.segments) ? data.coverage.segments.filter(segment => segment.status !== "complete").length : 0 };
}

export function assertResourceTelemetryQuery(query: ResourceTelemetryQuery, mode: ResourceTelemetryMode) {
  if (query.path !== resourceTelemetryEndpoint(mode) || query.status !== 200 || query.views !== RESOURCE_TELEMETRY_VIEWS) throw new Error("TELEMETRY_DATA_COVERAGE_MISMATCH");
  // A just-created local history has real gaps. Never upgrade it to complete.
  if (mode === "summary" && (query.coverageStatus !== "partial" || query.incompleteSegments < 1)) throw new Error("TELEMETRY_HISTORY_GAPS_MISSING");
}
