import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { handle, type Database, type Env, type Statement } from "../../../workers/telemetry/index";
import { signTicket } from "@/lib/telemetry/ticket";
import { beginTelemetryTask, completeTelemetryTask, configureTelemetry, flushTelemetry, observeAction, resetTelemetryIdentity, stepTelemetryTask } from "@/lib/telemetry/client";
import { TaskAnalysis } from "@/components/telemetry/analysis/TaskAnalysis";
import { AnalysisData } from "@/lib/telemetry/analysis-contract";
import type { Ticket } from "@/lib/telemetry/protocol";

// This exercises the real queue, receiver SQL/validation/deduplication, analysis and
// rendered UI through an in-process HTTP adapter and real local SQLite. No provider,
// account service, PostgreSQL, browser or external endpoint is contacted.
afterEach(() => { resetTelemetryIdentity(); vi.unstubAllGlobals(); });
it("takes an explicit non-OCR receipt from observer through local receiver to a mature UI cohort", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
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
    const now = Date.now();
    const env: Env = { DB: db, SIGNING_KEY: "local-fixture-signing-".repeat(3), ADMIN_KEY: "local-fixture-admin-".repeat(3), ALLOWED_ORIGIN: "https://local-fixture.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1" };
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
    const task = data.product.tasks.find(t => t.key === "profile")!;
    expect(task).toMatchObject({ attempts: 1, matured: 1, maturedCompleted: 1, start: 1, success: 1 });
    expect(task.steps.find(s => s.key === "confirm")?.reached).toBe(1);
    expect(task.steps.find(s => s.key === "result")?.reached).toBe(1);
    const html = renderToStaticMarkup(createElement(TaskAnalysis, { data, update: () => {} }));
    expect(html).toContain("完善参赛资料"); expect(html).toContain("1 / 1 个成熟尝试");
    resetTelemetryIdentity();
  } finally { sqlite.close(); }
});
