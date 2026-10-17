import { ErrorCode } from "@/lib/errors";
import { LIMITS, routeTemplate, safeFilters, UUID, VARIANTS, type Bootstrap, type Scene, type TelemetryEvent } from "./protocol";
import type { Operation } from "./operations";
import { TelemetryQueue } from "./queue";

let queue: TelemetryQueue | null = null;
let identity: string | null = null;
let session = "";
let activeAt = 0;
let sceneContext: { prefix: string; scene: Scene; eventId: string } | null = null;
let previousPage = "";
let historyNavigation = false;
const errorCodes = new Set<string>(Object.values(ErrorCode));
const storageKey = "rivalhub-product-session-v1";
function attempt(callback: () => void) { try { callback(); } catch { /* Observability cannot alter a business result. */ } }

export function configureTelemetry(config: Bootstrap | null) {
  attempt(() => {
    if (!config || navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) { queue = null; identity = null; return; }
    if (queue && identity === config.identity) { queue.configure(config); return; }
    queue = new TelemetryQueue(config);
    identity = config.identity;
    session = ""; previousPage = "";
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { id: string; identity: string; at: number } | null;
    if (stored && stored.identity === identity && UUID.test(stored.id) && Date.now() - stored.at < 1800000) { session = stored.id; activeAt = stored.at; }
  });
}

function context(): Pick<TelemetryEvent, "route" | "scene" | "eventId"> {
  const pathname = window.location.pathname;
  const scoped = sceneContext && (pathname === sceneContext.prefix || pathname.startsWith(`${sceneContext.prefix}/`)) ? sceneContext : null;
  return { route: routeTemplate(pathname), scene: scoped?.scene ?? "site", ...(scoped ? { eventId: scoped.eventId } : {}) };
}
export function setTelemetryScene(prefix: string, scene: string, eventId: string) {
  sceneContext = UUID.test(eventId) ? { prefix, scene: scene === "major" || scene === "rivals" ? scene : "other", eventId } : null;
}
function record(event: Omit<TelemetryEvent, "id" | "at" | "session" | "route" | "scene"> & Partial<Pick<TelemetryEvent, "route" | "scene">>, operationSession?: string) {
  attempt(() => {
    if (!queue) return;
    const now = Date.now();
    if (!session || now - activeAt >= 1800000) session = crypto.randomUUID();
    activeAt = now;
    attempt(() => sessionStorage.setItem(storageKey, JSON.stringify({ id: session, identity, at: now })));
    queue.add({ ...context(), ...event, id: crypto.randomUUID(), at: now, session: operationSession ?? session });
  });
}
export function markHistoryNavigation() { historyNavigation = true; }
export function recordPage() {
  attempt(() => {
    if (!queue) return;
    const filters = safeFilters(new URLSearchParams(window.location.search));
    // The raw URL is only an in-memory deduplication key, never an event field.
    const page = `${window.location.pathname}?${window.location.search}`;
    if (page === previousPage && !historyNavigation) return;
    const previousPath = previousPage.split("?")[0];
    const navigation = historyNavigation ? "history" : !previousPage && (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload" ? "reload" : "navigate";
    record({ kind: previousPath === window.location.pathname && !historyNavigation ? "filter" : "page", navigation, ...(Object.keys(filters).length ? { filters } : {}) });
    previousPage = page; historyNavigation = false;
  });
}
export function recordFilter(key: string, value: string) {
  attempt(() => {
    const filters = safeFilters(new URLSearchParams({ [key]: value }));
    if (Object.keys(filters).length) record({ kind: "filter", filters });
  });
}
export function recordClientError() { record({ kind: "error", errorCode: "CLIENT_UNHANDLED" }); }
export function flushTelemetry() { attempt(() => { void queue?.flush().catch(() => {}); }); }
export function resetTelemetryIdentity() {
  flushTelemetry(); queue = null; identity = null; session = ""; previousPage = "";
  attempt(() => sessionStorage.removeItem(storageKey));
}
export const telemetryFlushInterval = LIMITS.flushMs;

// Only these declared discriminants are read. Never enumerate or serialize action input.
function variantFor(operation: Operation, input: unknown): string | undefined {
  const field = (value: unknown, name: string): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, name)?.value : undefined;
  let value: unknown;
  if (operation === "bet.mutateBet" || operation === "bet.operateBet") value = field(input, "operation");
  if (operation === "predictions.mutatePrediction") value = field(input, "operation") === "join" ? "join" : field(input, "submitted") === true ? "pick_submit" : "pick_save";
  if (operation === "free-predictions.submitFreePrediction") value = field(input, "kind");
  if (operation === "matches.veto-room.performVetoRoomCommand") {
    const command = field(input, "command"); value = field(command, "kind") === "role_select" ? "role_select" : field(command, "actionType");
  }
  return typeof value === "string" && (VARIANTS as readonly string[]).includes(value) ? value : undefined;
}

/** Observe only the returned contract, never arguments, response data, messages, stacks or causes. */
export function observeAction<A extends unknown[], R>(operation: Operation, action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    if (!queue) return action(...args);
    let operationId = "";
    let started = 0;
    let captured: ReturnType<typeof context> | undefined;
    let variant: string | undefined;
    let filters: Record<string, string> | undefined;
    let operationSession: string | undefined;
    const actionQueue = queue;
    attempt(() => {
      operationId = crypto.randomUUID(); started = performance.now(); captured = context();
      variant = variantFor(operation, args[0]); filters = safeFilters(new URLSearchParams(window.location.search));
      record({ ...captured, kind: "operation", operation, operationId, phase: "start", ...(variant ? { variant } : {}) });
      operationSession = session;
    });
    const finish = (phase: TelemetryEvent["phase"], errorCode?: string, requestId?: string, outcome?: TelemetryEvent["outcome"]) => attempt(() => {
      // Do not attribute an old user's pending result to a new identity.
      if (!operationId || queue !== actionQueue) return;
      record({ ...captured, kind: "operation", operation, operationId, phase,
        ...(variant ? { variant } : {}), ...(phase !== "success" && filters && Object.keys(filters).length ? { filters } : {}),
        durationMs: Math.min(3600000, Math.max(0, Math.round(performance.now() - started))),
        ...(outcome ? { outcome } : {}), ...(errorCode ? { errorCode } : {}), ...(requestId && UUID.test(requestId) ? { requestId } : {}),
      }, operationSession);
    });
    try {
      const result = await action(...args);
      attempt(() => {
        const value = result as { success?: unknown; data?: { outcome?: unknown }; error?: { code?: unknown; requestId?: unknown } } | null;
        if (value?.success === true) {
          const outcome = value.data?.outcome;
          finish(outcome === "stale" ? "rejected" : "success", undefined, undefined, outcome === "applied" || outcome === "stale" || outcome === "noop" ? outcome : undefined);
        }
        else if (value?.success === false) {
          const code = typeof value.error?.code === "string" && errorCodes.has(value.error.code) ? value.error.code : "UNCLASSIFIED";
          finish(code === "INTERNAL_ERROR" || code === "PASSWORD_UPDATE_OUTCOME_UNKNOWN" ? "unknown" : "rejected", code, typeof value.error?.requestId === "string" ? value.error.requestId : undefined);
        } else finish("unknown", "INVALID_RESULT");
        if (value?.success === true && ["auth.loginWithPassword", "auth.logoutUser", "user-merge.executeSelfServiceUserMerge"].includes(operation)) resetTelemetryIdentity();
      });
      return result;
    } catch (error) { finish("unknown", "TRANSPORT_OR_THROW"); throw error; }
  };
}

/** Local export completion, not browser confirmation that a file reached disk. */
export function observeTask<A extends unknown[], R>(operation: Operation, task: (...args: A) => Promise<R>) {
  const observed = observeAction(operation, async (...args: A) => ({ success: true as const, data: await task(...args) }));
  return async (...args: A): Promise<R> => (await observed(...args)).data;
}
