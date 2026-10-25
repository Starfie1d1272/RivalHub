import { TelemetryTasks } from "./task-client";
import { TASK_DEFINITION_VERSION, taskForOperation, type TaskName, type TaskStep, type TaskValidationReason, type TaskMeasurement } from "./task-contract";
import { clientErrorFingerprint } from "./error-fingerprint";
import { ErrorCode } from "@/lib/errors";
import { LIMITS, routeTemplate, safeFilters, UUID, VARIANTS, type Bootstrap, type Scene, type TelemetryEvent, type MeasurementContext, READY_MODULES, READY_PHASES } from "./protocol";
import type { Operation } from "./operations";
import { classifyClient } from "./client-context";
import { TelemetryQueue } from "./queue";

let queue: TelemetryQueue | null = null;
let identity: string | null = null;
let session = "";
let activeAt = 0;
const taskExposures = new Set<string>();
type TaskAttemptContext = Pick<TelemetryEvent, "route" | "scene" | "eventId" | "measurement"> & { queue: TelemetryQueue; session: string };
const tasks = new TelemetryTasks<TaskAttemptContext>(report => {
  const { context: original, ...payload } = report;
  // The in-memory queue owner is never serialized; a changed identity invalidates it.
  if (!original || original.queue !== queue) return;
  record({ kind: "task", ...payload, route: original.route, scene: original.scene,
    eventId: original.eventId, measurement: original.measurement }, original.session);
}, undefined, undefined,
  () => typeof document !== "undefined" && document.visibilityState !== "hidden", TASK_DEFINITION_VERSION,
  () => {
    if (!queue) return;
    touchSession(Date.now());
    return { ...context(), queue, session, measurement: measurementContext() };
  });
let sceneContext: { prefix: string; scene: Scene; eventId: string } | null = null;
let previousPage = "";
let historyNavigation = false;
let bootstrap: Bootstrap | null = null;
let generation = 0;
let renewing = false;
let nextRenewalAttempt = 0;
const vitalIds = new Map<string, { id: string; session: string; measurement?: MeasurementContext }>();
let vitalNavigationAfter = 0;
let pendingNavigation: { target: string; started: number; queue: TelemetryQueue; navigation: "navigate" | "history" } | null = null;
let activeNavigation: { key: string; id: string; started: number; seen: Set<string>; lifecycle: NonNullable<MeasurementContext["lifecycle"]> } | null = null;
let hiddenSinceNavigation = typeof document !== "undefined" && document.visibilityState === "hidden";
function navigationLifecycle(kind: "hard" | "soft" | "bfcache" | "unknown", start: number): NonNullable<MeasurementContext["lifecycle"]> {
  const timing = performance.getEntriesByType("navigation")[0] as (PerformanceNavigationTiming & { activationStart?: number }) | undefined;
  const activation = timing?.activationStart ?? 0;
  return { navigationType: kind === "hard" && (activation > 0 || (document as Document & { prerendering?: boolean }).prerendering) ? "prerender" : kind,
    startedHidden: document.visibilityState === "hidden", resumed: false,
    startMs: Math.min(86400000, Math.max(0, Math.round(start))), activationMs: Math.min(86400000, Math.max(0, Math.round(activation))) };
}
export function recordTelemetryVisibility() {
  attempt(() => {
    if (document.visibilityState === "hidden") { hiddenSinceNavigation = true; tasks.pause(); }
    else if (hiddenSinceNavigation && activeNavigation) activeNavigation.lifecycle.resumed = true;
    if (activeNavigation?.lifecycle.navigationType === "prerender") {
      activeNavigation.lifecycle.activationMs = navigationLifecycle("hard", activeNavigation.started).activationMs;
    }
  });
}
export function restoreTelemetryPage(event: PageTransitionEvent) {
  attempt(() => {
    if (!event.persisted || !queue || bootstrap?.measurementVersion !== 1) return;
    activeNavigation = { key: window.location.pathname + window.location.search, id: crypto.randomUUID(), started: performance.now(), seen: new Set(), lifecycle: navigationLifecycle("bfcache", performance.now()) };
    pendingNavigation = null;
    hiddenSinceNavigation = document.visibilityState === "hidden";
    // A restore is a new navigation; mounted components need not mount again.
    previousPage = ""; recordPage();
  });
}
/** Capture when work starts; pass this token back so late ready cannot mark a newer navigation. */
export function captureTelemetryNavigation(): string | null {
  if (!queue || bootstrap?.measurementVersion !== 1) return null;
  const key = window.location.pathname + window.location.search;
  if (!activeNavigation || activeNavigation.key !== key) {
    hiddenSinceNavigation = document.visibilityState === "hidden";
    activeNavigation = { key, id: crypto.randomUUID(), started: pendingNavigation?.target === key ? pendingNavigation.started : previousPage ? performance.now() : 0, seen: new Set(), lifecycle: navigationLifecycle(pendingNavigation?.target === key ? "soft" : previousPage ? "unknown" : "hard", pendingNavigation?.target === key ? pendingNavigation.started : previousPage ? performance.now() : 0) };
  }
  return activeNavigation.id;
}
export function recordContentReady(token: string | null, module: typeof READY_MODULES[number], phase: typeof READY_PHASES[number]) {
  attempt(() => {
    if (!token || token !== captureTelemetryNavigation() || !activeNavigation || !READY_MODULES.includes(module) || !READY_PHASES.includes(phase)) return;
    const key = `${module}:${phase}`;
    if (activeNavigation.seen.has(key)) return;
    activeNavigation.seen.add(key);
    record({ kind: "ready", ready: { module, phase }, durationMs: Math.min(3600000, Math.max(0, Math.round(performance.now() - activeNavigation.started))) });
  });
}
/** Raw monotonic demand start and navigation identity are memory-only. */
export type TelemetryDemandToken = Readonly<{ navigationId: string; module: typeof READY_MODULES[number]; started: number }>;
const demands = new Map<TelemetryDemandToken, { queue: TelemetryQueue; phase?: typeof READY_PHASES[number] }>();
// Receiver/analysis support must be deployed before this client release.
const demandBasisEmissionEnabled = true;
export function beginTelemetryDemand(module: typeof READY_MODULES[number]): TelemetryDemandToken | null {
  let token: TelemetryDemandToken | null = null;
  attempt(() => {
    const navigationId = captureTelemetryNavigation();
    if (!queue || !navigationId || !READY_MODULES.includes(module)) return;
    for (const [key, owner] of demands) if (owner.queue !== queue || performance.now() - key.started > 3600000) demands.delete(key);
    token = Object.freeze({ navigationId, module, started: performance.now() });
    if (demands.size >= 32) demands.delete(demands.keys().next().value!);
    demands.set(token, { queue });
  });
  return token;
}
export function recordDemandReady(token: TelemetryDemandToken | null, phase: typeof READY_PHASES[number]): void {
  attempt(() => {
    const owner = token && demands.get(token);
    if (!token || !owner || owner.queue !== queue || token.navigationId !== captureTelemetryNavigation() || !READY_PHASES.includes(phase) || owner.phase || performance.now() - token.started > 3600000) return;
    owner.phase = phase;
    // Keep the navigation-to-first-ready observation, including late expansion/extrema.
    recordContentReady(token.navigationId, token.module, phase);
    if (!demandBasisEmissionEnabled) return;
    const ready = { module: token.module, phase, basis: "demand" as const };
    record({ kind: "ready", ready, durationMs: Math.max(0, Math.round(performance.now() - token.started)) });
  });
}
const errorCodes = new Set<string>(Object.values(ErrorCode));
const storageKey = "rivalhub-product-session-v1";
function privacyDisabled() { return navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true; }
function attempt(callback: () => void) { try {
  if (queue && privacyDisabled()) { tasks.reset(); demands.clear(); taskExposures.clear(); queue = null; bootstrap = null; identity = null; session = ""; previousPage = ""; generation++; vitalNavigationAfter = performance.now(); activeNavigation = null; pendingNavigation = null; vitalIds.clear(); sessionStorage.removeItem(storageKey); }
  callback();
} catch { /* Observability cannot alter a business result. */ } }

export function configureTelemetry(config: Bootstrap | null) {
  attempt(() => {
    generation++;
    if (!config || config.identity !== identity) { activeNavigation = null; demands.clear(); tasks.reset(); taskExposures.clear(); }
    if (!config || navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) {
      if (queue) vitalNavigationAfter = performance.now();
      tasks.reset(); demands.clear(); queue = null; identity = null; bootstrap = null;
      session = ""; previousPage = ""; sessionStorage.removeItem(storageKey);
      vitalIds.clear(); pendingNavigation = null;
      return;
    }
    if (config.measurementVersion !== 1) tasks.reset();
    bootstrap = config;
    if (queue && identity === config.identity) { queue.configure(config); return; }
    if (queue) vitalNavigationAfter = performance.now();
    queue = new TelemetryQueue(config);
    vitalIds.clear(); pendingNavigation = null;
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
function touchSession(now: number) {
  if (!session || now - activeAt >= 1800000) session = crypto.randomUUID();
  activeAt = now;
}
function measurementContext(): MeasurementContext | undefined {
  const navigationId = captureTelemetryNavigation();
  return navigationId ? { v: 1, navigationId, lifecycle: activeNavigation ? { ...activeNavigation.lifecycle } : undefined, clientRelease: process.env.RIVALHUB_RELEASE_COMMIT || "unknown", ...(process.env.RIVALHUB_RELEASE_TAG ? { clientVersion: process.env.RIVALHUB_RELEASE_TAG } : {}), visibility: document.visibilityState === "hidden" ? "hidden" : "visible" } : undefined;
}
function record(event: Omit<TelemetryEvent, "id" | "at" | "session" | "route" | "scene"> & Partial<Pick<TelemetryEvent, "route" | "scene">>, operationSession?: string, sampleId?: string) {
  attempt(() => {
    if (!queue) return;
    const now = Date.now();
    touchSession(now);
    attempt(() => sessionStorage.setItem(storageKey, JSON.stringify({ id: session, identity, at: now })));
    const capturedMeasurement = event.measurement ?? ((event.kind !== "performance" || event.metricName === "NAV_COMMIT") ? measurementContext() : undefined);
    const measurement = capturedMeasurement ? { ...capturedMeasurement, visibility: document.visibilityState === "hidden" ? "hidden" as const : "visible" as const } : undefined;
    queue.add({ ...context(), ...event,
      ...(measurement ? { measurement } : {}), client: classifyClient(navigator.userAgent, navigator.maxTouchPoints, document.referrer, window.location.origin), id: sampleId ?? crypto.randomUUID(), at: now, session: operationSession ?? session });
  });
}
export function markHistoryNavigation() { historyNavigation = true; }
/** Next.js router start hook; raw targets remain memory-only until the committed route matches. */
export function beginTelemetryNavigation(target: string, navigationType: string) {
  attempt(() => {
    pendingNavigation = null;
    if (!queue) return;
    const url = new URL(target, window.location.href);
    if (url.origin !== window.location.origin) return;
    activeNavigation = null;
    pendingNavigation = { target: url.pathname + url.search, started: performance.now(), queue, navigation: navigationType === "traverse" ? "history" : "navigate" };
  });
}

/** Read only declared numeric fields: entries, selectors, URLs and native metric IDs are never serialized. */
export function recordWebVital(metric: { name: string; value: number; id: string; navigationURL?: string; navigationStartTime?: number; navigationType?: string }) {
  attempt(() => {
    if (!queue || !["TTFB", "FCP", "LCP", "INP", "CLS"].includes(metric.name) || !Number.isFinite(metric.value) || metric.value < 0 || metric.value > (metric.name === "CLS" ? 100 : 3600000) || typeof metric.id !== "string" || metric.id.length > 128) return;
    if ((metric.navigationStartTime ?? 0) < vitalNavigationAfter) return;
    const initialUrl = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.name;
    const source = metric.navigationURL ?? initialUrl;
    if (!source) return;
    const url = new URL(source, window.location.href);
    if (url.origin !== window.location.origin) return;
    const key = `${metric.name}:${metric.id}`;
    let sample = vitalIds.get(key);
    if (!sample) {
      touchSession(Date.now());
      sample = { id: crypto.randomUUID(), session };
      if (bootstrap?.measurementVersion === 1) {
        const start = metric.navigationStartTime ?? 0;
        const kind = metric.navigationType === "soft-navigation" ? "soft" : metric.navigationType === "back-forward-cache" ? "bfcache" : metric.navigationType === "prerender" ? "prerender" : ["navigate", "reload", "back-forward"].includes(metric.navigationType ?? "") ? "hard" : "unknown";
        const lifecycle = navigationLifecycle(kind === "prerender" ? "hard" : kind, Number.isFinite(start) ? start : 0);
        lifecycle.navigationType = kind;
        // No inferred association from the current URL or native metric ID.
        const matchedNavigation = metric.navigationStartTime !== undefined && activeNavigation &&
          activeNavigation.key === url.pathname + url.search && activeNavigation.started === start &&
          activeNavigation.lifecycle.navigationType === kind ? activeNavigation.id : null;
        sample.measurement = { v: 1, navigationId: matchedNavigation ?? crypto.randomUUID(), clientRelease: process.env.RIVALHUB_RELEASE_COMMIT || "unknown", ...(process.env.RIVALHUB_RELEASE_TAG ? { clientVersion: process.env.RIVALHUB_RELEASE_TAG } : {}), visibility: document.visibilityState === "hidden" ? "hidden" : "visible", lifecycle };
      }
      vitalIds.set(key, sample);
      if (vitalIds.size > 128) vitalIds.delete(vitalIds.keys().next().value!);
    }
    const current = url.pathname === window.location.pathname;
    record({ kind: "performance", metricName: metric.name as TelemetryEvent["metricName"], ...(metric.name === "CLS" ? { score: Math.round(metric.value * 10000) / 10000 } : { durationMs: Math.round(metric.value) }),
      ...(sample.measurement ? { measurement: sample.measurement } : {}),
      route: routeTemplate(url.pathname), ...(current ? {} : { scene: "site", eventId: undefined }),
    }, sample.session, sample.id);
  });
}
export function recordPage() {
  attempt(() => {
    if (!queue) return;
    captureTelemetryNavigation();
    const pending = pendingNavigation;
    if (pending?.target === window.location.pathname + window.location.search) {
      pendingNavigation = null;
      const elapsed = performance.now() - pending.started;
      if (pending.queue === queue && elapsed >= 0 && elapsed <= 3600000) {
        record({ kind: "performance", metricName: "NAV_COMMIT", durationMs: Math.round(elapsed), navigation: pending.navigation });
      }
    }
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
export function recordClientBoundaryError(error: unknown) { recordClientError(undefined, error); }
export function recordClientError(event?: Event, boundaryError?: unknown) {
  attempt(() => {
    if (bootstrap?.measurementVersion !== 1) { record({ kind: "error", errorCode: "CLIENT_UNHANDLED" }); return; }
    const error: unknown = event instanceof ErrorEvent ? event.error : typeof PromiseRejectionEvent !== "undefined" && event instanceof PromiseRejectionEvent ? event.reason : boundaryError;
    // Read only an own data property: never invoke arbitrary getters or collect message/stack/URL.
    const name = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "name")?.value : undefined;
    const category = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "Error"].includes(name) ? name : error instanceof TypeError ? "TypeError" : error instanceof Error ? "Error" : "unknown";
    const fingerprint = clientErrorFingerprint(error, event instanceof ErrorEvent ? { filename: event.filename, line: event.lineno, column: event.colno } : undefined);
    record({ kind: "error", errorCode: "CLIENT_UNHANDLED", clientError: { source: event?.type === "error" ? "window_error" : event?.type === "unhandledrejection" ? "unhandled_rejection" : "boundary", category, ...(fingerprint ? { fingerprint } : {}) } });
  });
}
export function flushTelemetry() { attempt(() => { tasks.checkpoint(); void queue?.flush().catch(() => {}); }); }
export function resetTelemetryIdentity() {
  flushTelemetry(); tasks.reset(); demands.clear(); taskExposures.clear(); generation++; nextRenewalAttempt = 0; bootstrap = null; queue = null; identity = null; session = ""; previousPage = "";
  vitalIds.clear(); pendingNavigation = null; activeNavigation = null;
  vitalNavigationAfter = performance.now();
  attempt(() => sessionStorage.removeItem(storageKey));
}
export const telemetryFlushInterval = LIMITS.flushMs;

async function requestBootstrap(): Promise<Bootstrap | null> {
  const response = await fetch("/api/product-telemetry", {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("renewal_failed");
  return response.json();
}

/** Once per ~20h on a visible tab; failure retries at most hourly, never per click. */
export async function renewTelemetryIfNeeded(renew: () => Promise<Bootstrap | null | undefined> = requestBootstrap) {
  if (!queue || !bootstrap || renewing || document.visibilityState === "hidden" || Date.now() < bootstrap.expiresAt - 4 * 3600000 || Date.now() < nextRenewalAttempt) return;
  renewing = true; nextRenewalAttempt = Date.now() + 3600000;
  const captured = generation; let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      renew(),
      new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 5000); }),
    ]);
    if (captured === generation && value !== undefined) configureTelemetry(value);
  } catch { /* Renewal failure never blocks an action or retries that action. */ }
  finally { clearTimeout(timeout); renewing = false; }
}

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
    let operationMeasurement: MeasurementContext | undefined;
    let operationTask: TaskMeasurement | undefined;
    const actionQueue = queue;
    attempt(() => {
      operationId = crypto.randomUUID(); started = performance.now(); captured = context();
      variant = variantFor(operation, args[0]); filters = safeFilters(new URLSearchParams(window.location.search));
      const taskName = taskForOperation(operation);
      const taskAttempt = taskName ? tasks.captureWithContext(taskName, `${window.location.pathname}:`) : undefined;
      if (taskAttempt?.context?.queue === actionQueue) {
        const original = taskAttempt.context;
        operationTask = taskAttempt.task;
        captured = { route: original.route, scene: original.scene, eventId: original.eventId };
        operationSession = original.session;
        operationMeasurement = original.measurement;
      }
      record({ ...captured, ...(operationMeasurement ? { measurement: operationMeasurement } : {}), ...(operationTask ? { task: operationTask } : {}), kind: "operation", operation, operationId, phase: "start", ...(variant ? { variant } : {}) }, operationSession);
      operationSession ??= session;
      operationMeasurement ??= measurementContext();
    });
    const finish = (phase: TelemetryEvent["phase"], errorCode?: string, requestId?: string, outcome?: TelemetryEvent["outcome"]) => attempt(() => {
      // Do not attribute an old user's pending result to a new identity.
      if (!operationId || queue !== actionQueue) return;
      record({ ...captured, ...(operationMeasurement ? { measurement: operationMeasurement } : {}), ...(operationTask ? { task: operationTask } : {}), kind: "operation", operation, operationId, phase,
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
        if (queue === actionQueue && value?.success === true && operation === "auth.loginWithPassword") completeTelemetryTask("login", operationTask?.attemptId ?? null);
        if (queue === actionQueue && value?.success === true && ["auth.loginWithPassword", "auth.logoutUser", "user-merge.executeSelfServiceUserMerge"].includes(operation)) resetTelemetryIdentity();
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


export function beginTelemetryTask(name: TaskName, scope = "", step: TaskStep = "edit"): string | null {
  let token: string | null = null;
  attempt(() => { if (queue && bootstrap?.measurementVersion === 1) token = tasks.begin(name, `${window.location.pathname}:${scope}`, step); });
  return token;
}
export function activityTelemetryTask(name: TaskName, token?: string | null) { attempt(() => { if (queue) tasks.activity(name, token); }); }
export function stepTelemetryTask(name: TaskName, step: TaskStep, token?: string | null) { attempt(() => { if (queue && token) tasks.step(name, step, token); }); }
export function completeTelemetryTask(name: TaskName, token?: string | null) { attempt(() => { if (queue && token) tasks.finish(name, "complete", token); }); }
export function cancelTelemetryTask(name: TaskName, token?: string | null) { attempt(() => { if (queue && token) tasks.finish(name, "cancel", token); }); }
export function forgetTelemetryTask(name: TaskName, token?: string | null) { attempt(() => tasks.forget(name, token)); }

export function recordTaskValidation(name: TaskName, reason: TaskValidationReason, token?: string | null) { attempt(() => { if (queue && token) tasks.validation(name, reason, token); }); }

/** Denominator only for an explicitly eligible, mounted entry; never inferred from all page views. */
export function exposeTelemetryTask(name: TaskName, scope = ""): boolean {
  let recorded = false;
  attempt(() => {
    const navigationId = captureTelemetryNavigation();
    if (!navigationId || !queue) return;
    const key = `${navigationId}:${name}:${scope}`;
    if (taskExposures.has(key)) { recorded = true; return; }
    if (taskExposures.size >= 100) taskExposures.delete(taskExposures.values().next().value!);
    taskExposures.add(key);
    record({ kind: "task", task: { name, definitionVersion: TASK_DEFINITION_VERSION, attemptId: crypto.randomUUID(), step: "ready", phase: "exposure" } });
    recorded = true;
  });
  return recorded;
}
