import { ROUTES } from "./routes";

export const DASHBOARD_BATCH_LIMIT = 1000;
export interface DashboardFilters { hours: "6" | "24" | "168"; release: string; route: string }

/** Shared trust boundary; keep the independent receiver free of a schema-library bundle. */
export function parseDashboardFilters(input: unknown): DashboardFilters | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !["hours", "release", "route"].includes(key))) return null;
  const { hours = "24", release = "", route = "" } = values;
  if (hours !== "6" && hours !== "24" && hours !== "168") return null;
  if (typeof release !== "string" || !/^[A-Za-z0-9._-]{0,80}$/.test(release)) return null;
  if (typeof route !== "string" || (route !== "" && route !== "/unknown" && !(ROUTES as readonly string[]).includes(route))) return null;
  return { hours, release, route };
}
