import { Blob as NodeBlob } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { handle, type Env, type Statement } from "../../../workers/telemetry/index";
import { maintainHistory, readHistory } from "../../../workers/telemetry/history";
import { historyDefaults } from "@/lib/telemetry/history-contract";
import { signTicket } from "@/lib/telemetry/ticket";
import { validEvent, type TelemetryEvent } from "@/lib/telemetry/protocol";
// Exercise the future v2 mode through the real collector without enabling it in shipped code.
vi.mock("@/lib/telemetry/task-client", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/telemetry/task-client")>();
  return { ...original, TelemetryTasks: new Proxy(original.TelemetryTasks, {
    construct(target, args) { args[4] = 2; return Reflect.construct(target, args); },
  }) };
});
import { beginTelemetryTask, activityTelemetryTask, stepTelemetryTask, completeTelemetryTask, configureTelemetry, flushTelemetry, observeAction, resetTelemetryIdentity } from "@/lib/telemetry/client";
afterEach(() => { resetTelemetryIdentity(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("accepts the real v2 collector's 100ms call after 61 active registration minutes", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); const start = Date.UTC(2026, 9, 25); vi.setSystemTime(start);
  let mono = 0; vi.spyOn(performance, "now").mockImplementation(() => mono);
  window.history.replaceState(null, "", "/fixture-season/register");
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(readFileSync("workers/telemetry/schema.sql", "utf8"));
  const wrap = (sql: string, values: (string | number | null | ArrayBuffer)[] = []): Statement => ({
    bind: (...args) => wrap(sql, args),
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...values.map(v => typeof v === "object" && v !== null ? new Uint8Array(v) : v)) as T[] }),
    first: async <T,>() => sqlite.prepare(sql).get(...values.map(v => typeof v === "object" && v !== null ? new Uint8Array(v) : v)) as T ?? null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values.map(v => typeof v === "object" && v !== null ? new Uint8Array(v) : v)).changes) } }),
  });
  const env: Env = { SIGNING_KEY: "fixture-signing-".repeat(3), ADMIN_KEY: "fixture-admin-".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1", HISTORY_RETENTION_DAYS: "90", DB: { prepare: wrap, batch: async statements => {
    sqlite.exec("BEGIN"); try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
  const ticket = await signTicket({ v: 1, id: crypto.randomUUID(), account: null, role: "user", release: "fixture", environment: "production", origin: env.ALLOWED_ORIGIN, exp: start + 86400000 }, env.SIGNING_KEY);
  const sent: TelemetryEvent[] = []; const statuses: number[] = [];
  const send = vi.fn<typeof fetch>(async (url, init) => {
    const events: TelemetryEvent[] = JSON.parse(String(init?.body)).events;
    expect(events.every(e => validEvent(e, Date.now()))).toBe(true); sent.push(...events);
    const response = await handle(new Request(String(url), { ...init, headers: { origin: env.ALLOWED_ORIGIN } }), env, Date.now());
    statuses.push(response.status); return response;
  });
  vi.stubGlobal("fetch", send);
  try {
    await maintainHistory(env, start);
    configureTelemetry({ endpoint: "https://receiver.invalid/v1/batches", ticket, identity: "fixture", expiresAt: start + 86400000, measurementVersion: 1 });
    const token = beginTelemetryTask("registration", "fixture");
    flushTelemetry(); await vi.waitFor(() => expect(statuses).toHaveLength(1)); expect(statuses[0]).toBe(204);
    mono = 10000; vi.setSystemTime(start + mono);
    Reflect.apply(activityTelemetryTask, undefined, ["registration", token]); stepTelemetryTask("registration", "review", token);
    flushTelemetry(); await vi.waitFor(() => expect(statuses).toHaveLength(2)); expect(statuses[1]).toBe(204);
    await maintainHistory(env, Date.now() + 1);
    expect(sqlite.prepare("SELECT active FROM history_samples WHERE kind='task'").get()?.active).toBe(10000);
    for (let minute = 1; minute <= 61; minute++) {
      mono = minute * 60000; vi.setSystemTime(start + mono); Reflect.apply(activityTelemetryTask, undefined, ["registration", token]);
    }
    stepTelemetryTask("registration", "submit", token);
    await observeAction("register.submitRegistration", async () => {
      mono += 100; vi.setSystemTime(start + mono); return { success: true, data: undefined };
    })();
    completeTelemetryTask("registration", token); stepTelemetryTask("registration", "result", token);
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(Date.now() + 1000); flushTelemetry();
      await new Promise(resolve => setTimeout(resolve, 10));
      if (sent.some(e => e.kind === "operation" && e.phase === "success") && sent.some(e => e.kind === "task" && e.task?.phase === "complete") && sent.some(e => e.kind === "task" && e.task?.step === "result") && statuses.length === send.mock.calls.length) break;
    }
    const result = sent.find(e => e.kind === "operation" && e.phase === "success")!;
    expect(result).toMatchObject({ durationMs: 100, task: { definitionVersion: 2, elapsedCensored: true, activeCensored: true, activeMs: 3600000 } });
    expect(statuses.every(status => status === 204)).toBe(true);
    const originalSession = sent.find(e => e.kind === "task" && e.task?.phase === "start")!.session;
    expect(sent.filter(e => e.kind === "task" || e.kind === "operation").every(e => e.session === originalSession)).toBe(true);
    await maintainHistory(env, Date.now() + 1);
    const history = await readHistory(env, historyDefaults, Date.now() + 2);
    expect(sqlite.prepare("SELECT phase,value,active FROM history_samples WHERE kind='task'").get()).toEqual({ phase: "complete", value: null, active: null });
    expect(history.timingRows.find(r => r.kind === "task")).toMatchObject({ definitionVersion: 2, elapsedCensored: true, activeCensored: true, duration: { n: 0 }, active: { n: 0 } });
    expect(history.timingRows.find(r => r.kind === "operation")).toMatchObject({ duration: { n: 1, sum: 100 }, elapsedCensored: false });
    expect(sent.filter(e => e.kind === "task" && e.task?.phase === "complete")).toHaveLength(1);
    console.info(JSON.stringify({ fixture: "real_v2_client_queue_receiver_history", originalSessionPreserved: true, priorActiveMs: 10000, finalTaskActive: null, taskElapsedN: 0, taskActiveN: 0, operationHistoryMs: 100, operationMs: result.durationMs, requests: statuses.length, statuses, elapsedCensored: result.task?.elapsedCensored, activeCensored: result.task?.activeCensored }));
  } finally { configureTelemetry(null); sqlite.close(); }
});
