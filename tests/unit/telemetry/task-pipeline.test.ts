import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { handle, type Database, type Env, type Statement } from "../../../workers/telemetry/index";
import { signTicket } from "@/lib/telemetry/ticket";
import { beginTelemetryDemand, recordDemandReady, exposeTelemetryTask, beginTelemetryTask, completeTelemetryTask, configureTelemetry, flushTelemetry, observeAction, resetTelemetryIdentity, stepTelemetryTask } from "@/lib/telemetry/client";
import { TaskAnalysis } from "@/components/telemetry/analysis/TaskAnalysis";
import { AnalysisData } from "@/lib/telemetry/analysis-contract";
import { maintainHistory } from "../../../workers/telemetry/history";
import { historyDayStart, HISTORY_DAY } from "@/lib/telemetry/history-contract";
import { LongWindowSummary } from "@/lib/telemetry/long-window-contract";
import type { Ticket } from "@/lib/telemetry/protocol";

// This exercises the real queue, receiver SQL/validation/deduplication, analysis and
// rendered UI through an in-process HTTP adapter and real local SQLite. No provider,
// account service, PostgreSQL, browser or external endpoint is contacted.
afterEach(() => { resetTelemetryIdentity(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("workers/telemetry/schema.sql", "utf8"));
  const wrap = (sql: string, values: (string | number | null | ArrayBuffer)[] = []): Statement => {
    const args = () => values.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v);
    return { bind: (...v) => wrap(sql, v),
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...args()) as T[] }),
      first: async <T>() => sqlite.prepare(sql).get(...args()) as T ?? null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args()).changes) } }),
    };
  };
  const db: Database = { prepare: wrap, batch: async statements => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const env: Env = { DB: db, SIGNING_KEY: "local-fixture-signing-".repeat(3), ADMIN_KEY: "local-fixture-admin-".repeat(3), ALLOWED_ORIGIN: "https://local-fixture.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1" };
  return { sqlite, env };
}
it("takes an explicit non-OCR receipt from observer through local receiver to a mature UI cohort", async () => {
  const { sqlite, env } = fixture();
  const now = Date.now();
  try {
    // The local analysis endpoint selects this protocol environment label. It is not a production test.
    const ticket: Ticket = { v: 1, id: crypto.randomUUID(), account: null, role: "anonymous", release: "local-fixture", environment: "production", origin: env.ALLOWED_ORIGIN, exp: now + 86400000 };
    const config = { endpoint: "https://receiver.invalid/v1/batches", ticket: await signTicket(ticket, env.SIGNING_KEY), identity: "anonymous", expiresAt: ticket.exp, measurementVersion: 1 as const };
    vi.stubGlobal("window", { location: new URL(`${env.ALLOWED_ORIGIN}/settings`) });
    vi.stubGlobal("document", { visibilityState: "visible", referrer: "" });
    vi.stubGlobal("navigator", { userAgent: "fixture", maxTouchPoints: 0 });
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
    let body = ""; const statuses: number[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      body = String(init.body);
      const response = await handle(new Request(url, { ...init, headers: { origin: env.ALLOWED_ORIGIN } }), env, now);
      statuses.push(response.status); return response;
    });
    configureTelemetry(config);
    const token = beginTelemetryTask("profile", "local-fixture", "submit");
    let calls = 0;
    await observeAction("account.updateProfile", async () => { calls++; return { success: true as const }; })();
    // Navigate away before the A task receipt; the receiver's A-route filter must still close it.
    vi.stubGlobal("window", { location: new URL(`${env.ALLOWED_ORIGIN}/teams`) });
    completeTelemetryTask("profile", token); completeTelemetryTask("profile", token);
    stepTelemetryTask("profile", "result", token); flushTelemetry();
    await vi.waitFor(() => expect(statuses).toEqual([204]));
    const input = JSON.parse(body);
    expect(input.events).toHaveLength(5); // task start, operation start/success, receipt, presentation
    expect(calls).toBe(1);
    const duplicate = await handle(new Request(config.endpoint, { method: "POST", headers: { origin: env.ALLOWED_ORIGIN }, body }), env, now + 1);
    expect(duplicate.status).toBe(204);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(1);
    const response = await handle(new Request("https://receiver.invalid/admin/analysis?task=profile&route=%2Fsettings", { headers: { authorization: `Bearer ${env.ADMIN_KEY}` } }), env, now + 31 * 60000);
    expect(response.status).toBe(200);
    const data = AnalysisData.parse(await response.json());
    const task = data.product.tasks.find(t => t.key === "profile" && t.definitionVersion === 2)!;
    expect(task).toMatchObject({ attempts: 1, matured: 1, maturedCompleted: 1, start: 1, success: 1 });
    expect(task.steps.find(s => s.key === "confirm")?.reached).toBe(1);
    expect(task.steps.find(s => s.key === "result")?.reached).toBe(1);
    const html = renderToStaticMarkup(createElement(TaskAnalysis, { data, update: () => {} }));
    expect(html).toContain("完善参赛资料"); expect(html).toContain("1 / 1 个成熟尝试");
    resetTelemetryIdentity();
  } finally { sqlite.close(); }
});

it("keeps an idle hour-old registration call in its original receiver session while a new task gets a new session", async () => {
  const { sqlite, env } = fixture();
  let wall = historyDayStart("2026-10-25") + 1000, monotonic = 0;
  vi.spyOn(Date, "now").mockImplementation(() => wall);
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  try {
    const started = wall;
    env.HISTORY_RETENTION_DAYS = "90";
    const day = historyDayStart("2026-10-25");
    await maintainHistory(env, day);
    const ticket: Ticket = { v: 1, id: crypto.randomUUID(), account: null, role: "anonymous", release: "local-fixture", environment: "production", origin: env.ALLOWED_ORIGIN, exp: wall + 86400000 };
    vi.stubGlobal("window", { location: new URL(`${env.ALLOWED_ORIGIN}/original/register`) });
    vi.stubGlobal("document", { visibilityState: "visible", referrer: "" });
    vi.stubGlobal("navigator", { userAgent: "fixture", maxTouchPoints: 0 });
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
    const batches: { events: import("@/lib/telemetry/protocol").TelemetryEvent[] }[] = [];
    const statuses: number[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      batches.push(JSON.parse(String(init.body)));
      const response = await handle(new Request(url, { ...init, headers: { origin: env.ALLOWED_ORIGIN } }), env, wall);
      statuses.push(response.status); return response;
    });
    configureTelemetry({ endpoint: "https://receiver.invalid/v1/batches", ticket: await signTicket(ticket, env.SIGNING_KEY), identity: "anonymous", expiresAt: ticket.exp, measurementVersion: 1 });
    expect(exposeTelemetryTask("registration", "original")).toBe(true);
    const token = beginTelemetryTask("registration", "original", "edit");
    flushTelemetry(); await vi.waitFor(() => expect(statuses).toEqual([204]));
    const originalSession = batches[0].events[0].session;
    wall += 3600001; monotonic += 3600001;
    await observeAction("register.submitRegistration", async () => { wall += 100; monotonic += 100; return { success: true }; })();
    completeTelemetryTask("registration", token);
    const independent = beginTelemetryTask("profile", "independent", "submit");
    completeTelemetryTask("profile", independent);
    flushTelemetry(); await vi.waitFor(() => expect(statuses).toEqual([204, 204]));
    const operation = batches[1].events.find(e => e.kind === "operation" && e.phase === "success")!;
    expect(operation).toMatchObject({ session: originalSession, durationMs: 100, task: { attemptId: token, definitionVersion: 2, elapsedCensored: true } });
    expect(batches[1].events.every(e => e.session === originalSession)).toBe(true);
    expect(batches[0].events.find(e => e.task?.phase === "exposure")?.task?.definitionVersion).toBe(2);
    expect(batches[1].events.find(e => e.task?.phase === "complete")).toMatchObject({ durationMs: 3600000, task: { definitionVersion: 2, elapsedCensored: true } });
    wall += 1000; monotonic += 1000; flushTelemetry();
    await vi.waitFor(() => expect(statuses).toEqual([204, 204, 204]));
    expect(batches[2].events[0].session).not.toBe(originalSession);
    // Same-navigation repeated demands stay distinct, each receipt is idempotent.
    const demand = beginTelemetryDemand("player"); wall += 250; monotonic += 250;
    recordDemandReady(demand, "advanced"); recordDemandReady(demand, "advanced");
    const another = beginTelemetryDemand("player"); wall += 100; monotonic += 100;
    recordDemandReady(another, "advanced");
    // A genuine unknown transport result remains unknown and has no invented task.
    await expect(observeAction("account.updateProfile", async () => { throw new Error("fixture transport"); })()).rejects.toThrow("fixture transport");
    wall += 1000; monotonic += 1000; flushTelemetry();
    await vi.waitFor(() => expect(statuses).toEqual([204, 204, 204, 204]));
    const ready = batches[3].events.filter(e => e.kind === "ready");
    expect(ready.filter(e => e.ready?.basis === "demand").map(e => e.durationMs)).toEqual([250, 100]);
    expect(ready.filter(e => !e.ready?.basis).map(e => e.durationMs)).toEqual([3600000]);
    // Seed an explicit historical v1 cohort through the same receiver, never relabel it.
    const legacyId = crypto.randomUUID();
    const legacy = batches[0].events.find(e => e.task?.phase === "start")!;
    const legacyEvents = ["start", "complete"].map((phase, i) => ({ ...legacy, id: crypto.randomUUID(), at: wall + i, task: { name: "registration", definitionVersion: 1, attemptId: legacyId, phase, step: i ? "confirm" : "start" }, ...(i ? { durationMs: 100 } : {}) }));
    expect((await handle(new Request("https://receiver.invalid/v1/batches", { method: "POST", headers: { origin: env.ALLOWED_ORIGIN }, body: JSON.stringify({ v: 1, id: crypto.randomUUID(), ticket: await signTicket(ticket, env.SIGNING_KEY), events: legacyEvents }) }), env, wall + 1)).status).toBe(204);
    await maintainHistory(env, wall + 2);
    // Validate both live raw edges and full-day history + tail, using real receiver SQL.
    for (const [to, readAt] of [[wall + 2, wall + 2], [day + HISTORY_DAY - 1, day + HISTORY_DAY + 1000]]) {
      const query = new URLSearchParams({ from: new Date(day).toISOString(), to: new Date(to).toISOString() });
      const response = await handle(new Request("https://receiver.invalid/admin/long-window?" + query, { headers: { authorization: `Bearer ${env.ADMIN_KEY}` } }), env, readAt);
      expect(response.status).toBe(200);
      const summary = LongWindowSummary.parse(await response.json());
      expect(summary.metrics.filter(m => m.kind === "task" && m.name === "registration").map(m => m.definitionVersion).sort()).toEqual([1, 2]);
      expect(summary.metrics.find(m => m.kind === "operation" && m.definitionVersion === 2)).toMatchObject({ elapsedCensored: false, duration: { n: 1, sum: 100 } });
      expect(summary.metrics.find(m => m.kind === "task" && m.definitionVersion === 2 && m.name === "registration")).toMatchObject({ elapsedCensored: true, duration: { n: 0 } });
      expect(summary.metrics.find(m => m.kind === "operation" && m.definitionVersion === 0)).toMatchObject({ phase: "unknown", reports: 1 });
      expect(summary.metrics.find(m => m.kind === "ready" && m.basis === "navigation")).toMatchObject({ duration: { n: 1, sum: 3600000, max: 3600000 } });
      expect(summary.metrics.find(m => m.kind === "ready" && m.basis === "demand")).toMatchObject({ duration: { n: 2, sum: 350, max: 250 } });
    }
    const response = await handle(new Request("https://receiver.invalid/admin/analysis?task=registration", { headers: { authorization: `Bearer ${env.ADMIN_KEY}` } }), env, started + HISTORY_DAY + 7200000);
    expect(response.status).toBe(200);
    const data = AnalysisData.parse(await response.json());
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions.map(s => s.actions).sort()).toEqual([0, 1]);
    expect(data.product.tasks.find(t => t.key === "registration" && t.definitionVersion === 1)).toMatchObject({ attempts: 1, maturedCompleted: 1 });
    expect(data.product.tasks.find(t => t.key === "registration" && t.definitionVersion === 2)).toMatchObject({ attempts: 1, matured: 1, maturedCompleted: 1, start: 1, success: 1 });
    const beforePrivacy = statuses.length;
    const oldDemand = beginTelemetryDemand("team");
    const oldTask = beginTelemetryTask("profile", "old-identity");
    configureTelemetry({ endpoint: "https://receiver.invalid/v1/batches", ticket: await signTicket(ticket, env.SIGNING_KEY), identity: "different-account-fixture", expiresAt: ticket.exp, measurementVersion: 1 });
    completeTelemetryTask("profile", oldTask); recordDemandReady(oldDemand, "advanced"); flushTelemetry();
    expect(statuses).toHaveLength(beforePrivacy);
    const privateTask = beginTelemetryTask("profile", "private");
    const privateDemand = beginTelemetryDemand("team");
    vi.stubGlobal("navigator", { userAgent: "fixture", maxTouchPoints: 0, doNotTrack: "1" });
    completeTelemetryTask("profile", privateTask); recordDemandReady(privateDemand, "advanced"); flushTelemetry();
    expect(statuses).toHaveLength(beforePrivacy);
    resetTelemetryIdentity();
  } finally { sqlite.close(); }
});
