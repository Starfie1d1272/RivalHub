import { CLIENT_CATEGORIES } from "./client-context-contract";
import { ROUTES } from "./routes";
import { ROLES } from "./protocol";
export const analysisFields = [
  "hours",
  "scene",
  "role",
  "route",
  "device",
  "browser",
  "source",
  "release",
  "scope",
] as const;
export type AnalysisFilters = Record<(typeof analysisFields)[number], string>;
export const analysisDefaults: AnalysisFilters = {
  hours: "24",
  scene: "",
  role: "",
  route: "",
  device: "",
  browser: "",
  source: "",
  release: "",
  scope: "",
};
export const ANALYSIS_BATCH_LIMIT = 2000;
export const ANALYSIS_BYTES_LIMIT = 2 * 1024 * 1024;
export function parseAnalysisQuery(
  input: unknown,
): { filters: AnalysisFilters; session: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some((k) => ![...analysisFields, "session"].includes(k)))
    return null;
  const f = { ...analysisDefaults };
  for (const k of analysisFields) {
    if (p[k] !== undefined) {
      if (typeof p[k] !== "string") return null;
      f[k] = p[k] as string;
    }
  }
  if (
    !["6", "24", "168"].includes(f.hours) ||
    !["", "major", "rivals", "other", "site"].includes(f.scene) ||
    !["", ...ROLES].includes(f.role) ||
    !["", "admin", "public"].includes(f.scope)
  )
    return null;
  if (f.route && !["/unknown", ...ROUTES].includes(f.route)) return null;
  for (const k of ["device", "browser", "source"] as const)
    if (f[k] && !["missing", ...CLIENT_CATEGORIES[k]].includes(f[k]))
      return null;
  if (!/^[A-Za-z0-9._-]{0,80}$/.test(f.release)) return null;
  const session = p.session ?? "";
  if (typeof session !== "string" || !/^([a-f0-9]{32})?$/.test(session))
    return null;
  return { filters: f, session };
}
