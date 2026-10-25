import { ErrorCode } from "@/lib/errors";
import { OPERATIONS } from "./operations";
import { TASK_NAMES, TASK_STEPS, TASK_VALIDATION_REASONS, type TaskMeasurement } from "./task-contract";
import { ROUTES } from "./routes";
import { CLIENT_CATEGORIES, type ClientContext } from "./client-context-contract";
export { CLIENT_CATEGORIES, type ClientContext } from "./client-context-contract";

export const LIMITS = { batch: 32, bytes: 24576, queue: 256, flushMs: 60000, ageMs: 900000 } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROLES = ["anonymous", "user", "season_admin", "super_admin"] as const;
export type Role = typeof ROLES[number];
export type Scene = "major" | "rivals" | "other" | "site";
export const PERFORMANCE_METRICS = ["TTFB", "FCP", "LCP", "INP", "NAV_COMMIT", "CLS"] as const;
export const READY_MODULES = ["match", "schedule", "statistics", "player", "team", "bet", "prediction", "admin", "account", "public"] as const;
export const READY_PHASES = ["primary", "advanced", "form"] as const;
export interface MeasurementContext {
  v: 1; navigationId: string; clientRelease: string; clientVersion?: string;
  visibility: "visible" | "hidden";
  lifecycle?: { navigationType: "hard" | "soft" | "bfcache" | "prerender" | "unknown"; startedHidden: boolean; resumed: boolean; startMs: number; activationMs: number };

}
export interface TelemetryEvent {
  clientError?: { fingerprint?: string; source: "window_error" | "unhandled_rejection" | "boundary"; category: "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError" | "Error" | "unknown" };
  measurement?: MeasurementContext;
  task?: TaskMeasurement;
  ready?: { module: typeof READY_MODULES[number]; phase: typeof READY_PHASES[number] };
  id: string; at: number; session: string; route: string; scene: Scene;
  kind: "page" | "filter" | "operation" | "error" | "performance" | "ready" | "task";
  metricName?: typeof PERFORMANCE_METRICS[number];
  score?: number;
  client?: ClientContext;
  phase?: "start" | "success" | "rejected" | "unknown";
  operation?: typeof OPERATIONS[number]; operationId?: string; durationMs?: number;
  errorCode?: string; requestId?: string;
  navigation?: "navigate" | "history" | "reload";
  filters?: Record<string, string>; eventId?: string; outcome?: "applied" | "stale" | "noop";
  variant?: string;
}
export interface Ticket {
  v: 1; id: string; account: string | null; role: Role; release: string;
  environment: "preview" | "production"; origin: string; exp: number;
}
export interface Bootstrap { endpoint: string; ticket: string; identity: string; expiresAt: number; measurementVersion?: 1 }

/** Exact route templates only: invitation tokens, slugs and arbitrary 404 paths never leave the page. */
export function routeTemplate(pathname: string): string {
  const segments = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  return ROUTES.find((route) => {
    const parts = route.split("/").filter(Boolean);
    return parts.length === segments.length && parts.every((part, i) => part.startsWith("[") || part === segments[i]);
  }) ?? "/unknown";
}

const categories: Record<string, readonly string[]> = {
  tab: ["overview", "players", "teams", "maps", "weapons", "records", "free", "points", "result", "bp", "ranking", "matches", "stats", "active", "done"],
  ops: ["todo", "unproposed", "pending", "confirmed", "reschedule_pending", "uncovered", "conflict", "all"],
  position: ["all", "igl", "awper", "opener", "closer", "anchor"],
  stage: ["all", "play_in", "play-in", "stage1", "stage2", "playoff", "swiss", "playoffs", "group", "final"],
  source: ["all", "official", "test"],
  sort: ["rating", "ratingPro", "adr", "kd", "kills", "profit", "hits", "accuracy", "name", "team", "maps", "samples"],
  order: ["asc", "desc"], side: ["all", "ct", "t"],
  status: ["all", "pending", "approved", "rejected", "scheduled", "ongoing", "finished"],
  map: ["de_dust2", "de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_train", "de_overpass", "de_vertigo"],
  view: ["execution", "schedule", "materials", "performance", "veto", "all", "sim", "record", "flow", "compact", "list"],
  format: ["bo1", "bo3", "bo5"], mapsView: ["pool", "veto"],
  mapFilter: ["de_dust2", "de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_train", "de_overpass", "de_vertigo"],
};
/** Categorical selection only; search text and all arbitrary values become presence flags. */
export function safeFilters(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(categories)) {
    const value = params.get(key);
    if (value) out[key] = values.includes(value) ? value : "selected";
  }
  for (const key of ["q", "search", "team", "event", "player", "weapon", "minMaps", "teamFilter", "recordPage"]) {
    if (params.get(key)) out[key] = "selected";
  }
  return out;
}

const operationSet = new Set<string>(OPERATIONS);
const routes = new Set<string>([...ROUTES, "/unknown"]);
const allowedErrors = new Set<string>([...Object.values(ErrorCode), "UNCLASSIFIED", "INVALID_RESULT", "TRANSPORT_OR_THROW", "CLIENT_UNHANDLED"]);
export const VARIANTS = ["join", "stake", "enable", "pause", "resume", "retry", "close", "void", "pick_save", "pick_submit", "result", "bp", "ban", "pick", "side_pick", "role_select"] as const;
const fields = new Set(["id", "at", "session", "route", "scene", "kind", "phase", "operation", "operationId", "durationMs", "errorCode", "requestId", "navigation", "filters", "eventId", "outcome", "variant", "metricName", "score", "client", "measurement", "ready", "clientError", "task"]);
/** Receiver rejects unknown fields instead of persisting arbitrary client objects. */
export function validEvent(value: unknown, now: number): value is TelemetryEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (Object.keys(e).some((key) => !fields.has(key))) return false;
  if (typeof e.id !== "string" || !UUID.test(e.id) || typeof e.session !== "string" || !UUID.test(e.session)) return false;
  if (typeof e.at !== "number" || !Number.isInteger(e.at) || e.at < now - LIMITS.ageMs || e.at > now + 60000) return false;
  if (!routes.has(String(e.route)) || !["major", "rivals", "other", "site"].includes(String(e.scene))) return false;
  if (!["page", "filter", "operation", "error", "performance", "ready", "task"].includes(String(e.kind))) return false;
  if (e.kind !== "operation" && ["operation", "operationId", "phase", "outcome", "variant"].some(key => e[key] !== undefined)) return false;
  if (e.kind !== "operation" && e.kind !== "performance" && e.kind !== "ready" && e.kind !== "task" && e.durationMs !== undefined) return false;
  if (e.task !== undefined) {
    const t = e.task as TaskMeasurement;
    if (!["task", "operation"].includes(String(e.kind)) || !t || typeof t !== "object" || Array.isArray(t) || !Object.keys(t).every(key => ["attemptId", "definitionVersion", "name", "phase", "step", "activeMs", "validationReason"].includes(key)) || !(TASK_NAMES as readonly string[]).includes(t.name) || t.definitionVersion !== 1 || typeof t.attemptId !== "string" || !UUID.test(t.attemptId) || !(TASK_STEPS as readonly string[]).includes(t.step) || !["exposure", "start", "step", "complete", "cancel"].includes(t.phase) || (t.activeMs !== undefined && (typeof t.activeMs !== "number" || !Number.isInteger(t.activeMs) || t.activeMs < 0 || t.activeMs > 3600000))) return false;
    if (t.validationReason !== undefined && (t.step !== "validation" || !(TASK_VALIDATION_REASONS as readonly string[]).includes(t.validationReason))) return false;
    if (e.kind === "operation" && t.phase !== "step") return false;
  } else if (e.kind === "task") return false;
  if (e.clientError !== undefined) {
    const c = e.clientError as NonNullable<TelemetryEvent["clientError"]>;
    if (e.kind !== "error" || !c || typeof c !== "object" || Array.isArray(c) || !["category,source", "category,fingerprint,source"].includes(Object.keys(c).sort().join()) || (c.fingerprint !== undefined && (typeof c.fingerprint !== "string" || !/^s1:[0-9a-f]{16}$/.test(c.fingerprint))) || !["window_error", "unhandled_rejection", "boundary"].includes(c.source) || !["TypeError", "RangeError", "ReferenceError", "SyntaxError", "Error", "unknown"].includes(c.category)) return false;
  }
  if (e.measurement !== undefined) {
    const m = e.measurement as MeasurementContext;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Object.keys(m).every(key => ["v", "navigationId", "clientRelease", "clientVersion", "visibility", "lifecycle"].includes(key)) || m.v !== 1 || !UUID.test(String(m.navigationId)) || typeof m.clientRelease !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(m.clientRelease) || !["visible", "hidden"].includes(m.visibility) || (m.clientVersion !== undefined && (typeof m.clientVersion !== "string" || !/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(m.clientVersion) || m.clientVersion.length > 80))) return false;
  }
  const lifecycle = (e.measurement as MeasurementContext | undefined)?.lifecycle;
  if (lifecycle !== undefined && (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle) || Object.keys(lifecycle).sort().join() !== "activationMs,navigationType,resumed,startMs,startedHidden" || !["hard", "soft", "bfcache", "prerender", "unknown"].includes(lifecycle.navigationType) || typeof lifecycle.startedHidden !== "boolean" || typeof lifecycle.resumed !== "boolean" || ![lifecycle.startMs, lifecycle.activationMs].every(value => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 86400000))) return false;
  if (e.kind === "ready") {
    const r = e.ready as TelemetryEvent["ready"];
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).sort().join() !== "module,phase" || !(READY_MODULES as readonly string[]).includes(r.module) || !(READY_PHASES as readonly string[]).includes(r.phase) || e.durationMs === undefined || e.measurement === undefined) return false;
  } else if (e.ready !== undefined) return false;
  if (e.kind === "performance") {
    if (!(PERFORMANCE_METRICS as readonly string[]).includes(String(e.metricName))) return false;
    if (e.metricName === "CLS") {
      if (typeof e.score !== "number" || !Number.isFinite(e.score) || e.score < 0 || e.score > 100 || e.durationMs !== undefined) return false;
    } else if (e.durationMs === undefined || e.score !== undefined) return false;
    if (["errorCode", "requestId", "filters"].some(key => e[key] !== undefined)) return false;
  } else if (e.metricName !== undefined || e.score !== undefined) return false;
  if (e.client !== undefined) {
    if (!e.client || typeof e.client !== "object" || Array.isArray(e.client)) return false;
    const client = e.client as Record<string, unknown>;
    if (Object.keys(client).length !== Object.keys(CLIENT_CATEGORIES).length ||
      Object.entries(CLIENT_CATEGORIES).some(([key, allowed]) => typeof client[key] !== "string" || !(allowed as readonly string[]).includes(client[key] as string))) return false;
  }
  if (e.kind === "operation" && (!operationSet.has(String(e.operation)) || !UUID.test(String(e.operationId)) || !["start", "success", "rejected", "unknown"].includes(String(e.phase)))) return false;
  if (e.durationMs !== undefined && (typeof e.durationMs !== "number" || !Number.isInteger(e.durationMs) || e.durationMs < 0 || e.durationMs > 3600000)) return false;
  if (e.requestId !== undefined && !UUID.test(String(e.requestId))) return false;
  if (e.eventId !== undefined && !UUID.test(String(e.eventId))) return false;
  if (e.errorCode !== undefined && (typeof e.errorCode !== "string" || !allowedErrors.has(e.errorCode))) return false;
  if (e.navigation !== undefined && !["navigate", "history", "reload"].includes(String(e.navigation))) return false;
  if (e.outcome !== undefined && !["applied", "stale", "noop"].includes(String(e.outcome))) return false;
  if (e.variant !== undefined && !(VARIANTS as readonly string[]).includes(String(e.variant))) return false;
  if (e.filters !== undefined) {
    if (!e.filters || typeof e.filters !== "object" || Array.isArray(e.filters)) return false;
    const filters = e.filters as Record<string, string>;
    if (JSON.stringify(safeFilters(new URLSearchParams(filters))) !== JSON.stringify(filters)) return false;
  }
  return true;
}
