import { CLIENT_CATEGORIES } from "./client-context-contract";
import { ROUTES } from "./routes";
import { OPERATIONS } from "./operations";
import { ROLES, UUID } from "./protocol";
import { TASK_NAMES } from "./task-contract";
export const analysisFields = [
  "hours", "scene", "role", "route", "device", "browser", "source", "release", "scope",
  "eventId", "task", "operation", "navigationType", "visibility", "from", "to", "releaseBasis",
] as const;
export type AnalysisFilters = Record<(typeof analysisFields)[number], string>;
export const analysisDefaults: AnalysisFilters = {
  hours: "168", scene: "", role: "", route: "", device: "", browser: "", source: "", release: "", scope: "",
  eventId: "", task: "", operation: "", navigationType: "", visibility: "", from: "", to: "", releaseBasis: "client",
};
export const ANALYSIS_BATCH_LIMIT = 2000;
export const ANALYSIS_BYTES_LIMIT = 2 * 1024 * 1024;
export const ANALYSIS_RETENTION_MS = 7 * 86400000;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export function analysisWindow(f: AnalysisFilters, now: number) {
  const requestedFrom = f.from ? Date.parse(f.from) : now - Number(f.hours) * 3600000;
  const requestedTo = f.to ? Date.parse(f.to) : now;
  const from = Math.max(now - ANALYSIS_RETENTION_MS, Math.min(requestedFrom, now));
  const to = Math.max(from, Math.min(requestedTo, now));
  return { from, to, requestedFrom, requestedTo, retentionClipped: requestedFrom < now - ANALYSIS_RETENTION_MS || requestedTo > now,
    step: to - from > 86400000 ? 86400000 : 3600000, timeZone: "Asia/Shanghai" as const };
}
export function parseAnalysisQuery(input: unknown): { filters: AnalysisFilters; session: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some((k) => ![...analysisFields, "session"].includes(k))) return null;
  const f = { ...analysisDefaults };
  for (const k of analysisFields) {
    if (p[k] !== undefined) {
      if (typeof p[k] !== "string") return null;
      f[k] = p[k] as string;
    }
  }
  if (!["6", "24", "168"].includes(f.hours) ||
    !["", "major", "rivals", "other", "site"].includes(f.scene) ||
    !["", ...ROLES].includes(f.role) || !["", "admin", "public"].includes(f.scope) ||
    !["client", "ticket"].includes(f.releaseBasis) ||
    !["", "hard", "soft", "bfcache", "prerender", "unknown", "missing"].includes(f.navigationType) ||
    !["", "visible", "hidden", "missing"].includes(f.visibility)) return null;
  if (f.route && !["/unknown", ...ROUTES].includes(f.route)) return null;
  if (f.operation && !(OPERATIONS as readonly string[]).includes(f.operation)) return null;
  if (f.task && !(TASK_NAMES as readonly string[]).includes(f.task)) return null;
  if (f.eventId && f.eventId !== "missing" && !UUID.test(f.eventId)) return null;
  for (const k of ["device", "browser", "source"] as const)
    if (f[k] && !["missing", ...CLIENT_CATEGORIES[k]].includes(f[k])) return null;
  if (!/^[A-Za-z0-9._-]{0,80}$/.test(f.release)) return null;
  if (Boolean(f.from) !== Boolean(f.to)) return null;
  if (f.from && (!timestamp.test(f.from) || !timestamp.test(f.to) ||
    !Number.isFinite(Date.parse(f.from)) || !Number.isFinite(Date.parse(f.to)) ||
    Date.parse(f.to) <= Date.parse(f.from) || Date.parse(f.to) - Date.parse(f.from) > ANALYSIS_RETENTION_MS)) return null;
  const session = p.session ?? "";
  if (typeof session !== "string" || !/^([a-f0-9]{32})?$/.test(session)) return null;
  return { filters: f, session };
}
