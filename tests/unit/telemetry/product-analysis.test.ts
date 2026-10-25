import { describe, expect, it } from "vitest";
import { analyzeTelemetry, type EventRow } from "@/lib/telemetry/analysis-model";
import { AnalysisData } from "@/lib/telemetry/analysis-contract";
import { analysisDefaults, analysisWindow, parseAnalysisQuery } from "@/lib/telemetry/analysis-query";
import { TASKS } from "@/lib/telemetry/task-contract";
import { bucketStart } from "@/lib/telemetry/product-analysis";
const now = Date.parse("2026-10-25T05:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const measurement = { v: 1 as const, navigationId: id(100), clientRelease: "client-build", clientVersion: "v2.23.2", visibility: "visible" as const,
  lifecycle: { navigationType: "soft" as const, startedHidden: false, resumed: false, startMs: 0, activationMs: 0 } };
function row(n: number, changes: Partial<EventRow> = {}): EventRow {
  return { id: id(n), at: now - 3600000, received: now - 3600000, expires: now + 86400000, session: "a".repeat(32), account: "private-account",
    role: "super_admin", release: "ticket-build", route: "/admin/[seasonSlug]/matches/[matchId]", scene: "major", eventId: id(200), kind: "page", ...changes };
}
function analyze(events: EventRow[], filters = {}) {
  return analyzeTelemetry({ capturedAt: now, batches: 2, bytes: 2000, oldest: Math.min(now, ...events.map(e => e.received)), events,
    metricIds: events.filter(e => e.kind === "performance").map(e => e.id),
    usage: { budget: { batches: 5000, bytes: 8388608 }, usage: [], expiredBatches: 0 }, truncated: false, validUntil: now + 60000,
    ticketReleases: ["ticket-build", "other-ticket-build"],
  }, { ...analysisDefaults, ...filters });
}
// These assertions protect cohort denominators, missing version attribution and distinct
// content/navigation lifecycles; rendering tests cannot detect these data errors.
describe("product telemetry analysis", () => {
  it("validates the extended query and clips raw history without claiming missing observations are a data outage", () => {
    expect(parseAnalysisQuery({})?.filters.hours).toBe("168");
    for (const input of [{ task: "arbitrary" }, { operation: "delete.all" }, { eventId: "not-a-uuid" }, { releaseBasis: "mixed" },
      { from: "2026-10-20T00:00:00Z" }, { from: "2026-10-01T00:00:00Z", to: "2026-10-20T00:00:00Z" },
      { from: "2026-10-20", to: "2026-10-21" }, { navigationType: "any" }, { visibility: "any" }]) expect(parseAnalysisQuery(input)).toBeNull();
    const query = parseAnalysisQuery({ from: "2026-10-17T00:00:00Z", to: "2026-10-20T00:00:00Z", eventId: id(200), task: "veto" })!;
    expect(analysisWindow(query.filters, now)).toMatchObject({ from: now - 7 * 86400000, retentionClipped: true });
    expect(analyze([row(1)]).meta.partial).toBe(false);
    expect(bucketStart(Date.parse("2026-10-25T05:00:00Z"), 86400000)).toBe(Date.parse("2026-10-24T16:00:00Z"));
  });
  it("keeps missing client versions explicit and content-ready samples separate from web vital lifecycle ids", () => {
    const events = [row(1), row(2, { measurement }),
      row(3, { kind: "ready", measurement, ready: { module: "match", phase: "primary" }, durationMs: 900 }),
      row(4, { kind: "ready", at: now - 3599900, received: now - 3599900, measurement, ready: { module: "match", phase: "primary" }, durationMs: 1000 }),
      row(5, { kind: "performance", measurement: { ...measurement, navigationId: id(101) }, metricName: "LCP", durationMs: 1500 })];
    const all = AnalysisData.parse(analyze(events));
    expect(all.product.ready).toHaveLength(1);
    expect(all.product.ready[0]).toMatchObject({ n: 1, p50: 900 });
    expect(all.metrics.find(m => m.key === "LCP")).toMatchObject({ n: 1, p50: 1500 });
    expect(all.options.release).toEqual(expect.arrayContaining([{ value: "missing", label: "未采集客户端版本" }, { value: "client-build", label: "v2.23.2" }]));
    expect(analyze(events, { release: "client-build" }).totals.views).toBe(1);
    expect(analyze(events, { release: "ticket-build" }).totals.views).toBe(0);
    expect(analyze(events, { release: "ticket-build", releaseBasis: "ticket" }).totals.views).toBe(2);
    expect(analyze(events, { release: "ticket-build", releaseBasis: "ticket" }).options.release.map(o => o.value)).toContain("other-ticket-build");
    expect(analyze(events, { eventId: "missing" }).totals.views).toBe(0);
    expect(analyze(events, { navigationType: "soft" }).totals.views).toBe(1);
  });
  it("correlates late call results, deduplicates starts, and separates success timings from rejected responses", () => {
    const start = row(1, { kind: "operation", operation: "player-stats.savePlayerStats", operationId: id(70), phase: "start" });
    const events = [start, { ...start, id: id(2) },
      row(3, { kind: "operation", operation: start.operation, operationId: id(70), phase: "success", at: start.at + 300000, received: start.received + 300000, durationMs: 5000 }),
      row(4, { kind: "operation", operation: start.operation, operationId: id(71), phase: "start" }),
      row(5, { kind: "operation", operation: start.operation, operationId: id(71), phase: "rejected", durationMs: 10 }),
      row(6, { kind: "operation", operation: "auth.loginWithPassword", operationId: id(70), phase: "rejected", at: start.at + 600000, durationMs: 20 })];
    const data = analyze(events, { from: new Date(now - 2 * 3600000).toISOString(), to: new Date(now - 3500000).toISOString() });
    expect(data.totals).toMatchObject({ starts: 2, success: 1, rejected: 1 });
    expect(data.product.operationTrends[0]).toMatchObject({ start: 2, successTiming: { n: 1, p50: 5000 }, otherTiming: { n: 1, p50: 10 } });
    expect(data.product.operationTrends[0].points.reduce((n, p) => n + p.start, 0)).toBe(2);
  });
  it("uses mature attempt cohorts, distinguishes explicit cancellation, and does not infer funnels from OCR/save call counts", () => {
    const task = (attempt: number, phase: "start" | "step" | "complete" | "cancel", step: "start" | "review" | "result", activeMs?: number) =>
      ({ name: "score_entry" as const, definitionVersion: 1 as const, attemptId: id(attempt), phase, step, ...(activeMs === undefined ? {} : { activeMs }) });
    const events = [row(1, { kind: "task", task: task(10, "start", "start") }), row(2, { kind: "task", task: task(10, "start", "start") }),
      row(3, { kind: "task", at: now - 3500000, received: now - 3500000, task: task(10, "step", "review", 100000) }),
      row(4, { kind: "task", at: now - 3400000, received: now - 3400000, task: task(10, "complete", "result", 150000) }),
      row(5, { kind: "task", task: task(11, "start", "start") }), row(6, { kind: "task", task: task(11, "cancel", "review") }),
      row(7, { kind: "task", task: task(12, "start", "start") }),
      row(8, { kind: "task", at: now - 1000, received: now - 1000, task: task(13, "start", "start") }),
      row(9, { kind: "task", task: task(14, "complete", "result") })];
    const data = AnalysisData.parse(analyze(events));
    const score = data.product.tasks.find(t => t.key === "score_entry")!;
    expect(score).toMatchObject({ attempts: 4, matured: 3, maturedCompleted: 1, completed: 1, cancelled: 1, unobserved: 1, inProgress: 1,
      elapsed: { n: 1, p50: 200000 }, active: { n: 1, p50: 150000 } });
    expect(score.completionPct).toBeCloseTo(100 / 3);
    expect(score.steps.find(s => s.key === "review")).toMatchObject({ reached: 2 });
    expect(data.product.quality.orphanTaskReports).toBe(1);
    expect(JSON.stringify(data.product)).not.toContain("private-account");
    expect(JSON.stringify(data.product)).not.toContain(id(10));
    const legacy = analyze([row(20, { kind: "operation", operation: "player-stats.extractStatsFromScreenshot", operationId: id(30), phase: "start" })]);
    expect(legacy.product.tasks.find(t => t.key === "score_entry")).toMatchObject({ attempts: 0, completionPct: null, start: 1 });
    expect(TASKS.score_entry.windowMs).toBe(1800000);
  });
  it("aggregates only bounded different-day task usage and fixed validation reasons without exporting accounts", () => {
    const task = { name: "registration" as const, definitionVersion: 1 as const, attemptId: id(80), phase: "start" as const, step: "start" as const };
    const old = now - 2 * 86400000;
    const events = [row(1, { kind: "task", at: old, received: old, task }),
      row(2, { kind: "task", at: old + 100, received: old + 100, task: { ...task, phase: "step", step: "validation", validationReason: "required" } }),
      row(3, { kind: "task", task: { ...task, attemptId: id(81) } }),
      row(4, { kind: "task", task: { ...task, attemptId: id(82) } }),
      row(5, { kind: "task", account: undefined, task: { ...task, attemptId: id(83) } }),
      row(6, { kind: "task", task: { ...task, phase: "exposure", step: "ready", attemptId: id(84) } }),
      row(7, { kind: "performance", metricName: "LCP", durationMs: 100, at: old - 86400000, received: old - 86400000 })];
    const data = AnalysisData.parse(analyze(events)).product;
    const registration = data.tasks.find(t => t.key === "registration")!;
    expect(registration.repeatUsage).toEqual({ accounts: 1, repeatedAccounts: 1, accountDays: 2, unlinkedReports: 1, basis: "selected_window_distinct_beijing_days" });
    expect(registration).toMatchObject({ eligibleExposures: 1, eligibleSessions: 1, attempts: 4 });
    expect(registration.validations).toEqual([{ reason: "required", label: "必填项缺失", reports: 1, attempts: 1 }]);
    expect(data.quality.orphanTaskReports).toBe(0);
    expect(JSON.stringify(data)).not.toContain("private-account");
    const recent = analyze(events, { hours: "24" }).product.tasks.find(t => t.key === "registration")!;
    expect(recent.repeatUsage).toMatchObject({ repeatedAccounts: 0, accountDays: 1 });
  });
  it("uses the same full observation window for completion rates and duration comparisons", () => {
    const task = { name: "score_entry" as const, definitionVersion: 1 as const, attemptId: id(80), phase: "start" as const, step: "start" as const };
    const events = [row(1, { kind: "task", task }), row(2, { kind: "task", at: now - 3500000, received: now - 3500000, task: { ...task, phase: "complete", step: "result", activeMs: 50000 } }),
      row(3, { kind: "task", at: now - 1000, received: now - 1000, task: { ...task, attemptId: id(81) } }),
      row(4, { kind: "task", at: now - 500, received: now - 500, task: { ...task, attemptId: id(81), phase: "complete", step: "result", activeMs: 400 } })];
    const score = analyze(events).product.tasks.find(t => t.key === "score_entry")!;
    expect(score).toMatchObject({ completed: 2, matured: 1, maturedCompleted: 1, completionPct: 100, elapsed: { n: 1, p50: 100000 }, active: { n: 1, p50: 50000 } });
    const historical = analyze(events, { from: new Date(now - 7200000).toISOString(), to: new Date(now - 3550000).toISOString() }).product.tasks.find(t => t.key === "score_entry")!;
    expect(historical).toMatchObject({ matured: 1, completed: 1, completionPct: 100, elapsed: { n: 1, p50: 100000 } });
  });
  it("keeps distinct error fingerprints and excludes newer performance updates from an earlier comparison window", () => {
    const events = [row(1, { kind: "error", errorCode: "CLIENT_UNHANDLED", clientError: { category: "TypeError", source: "window_error", fingerprint: "s1:0000000000000001" } }),
      row(2, { kind: "error", errorCode: "CLIENT_UNHANDLED", clientError: { category: "TypeError", source: "window_error", fingerprint: "s1:0000000000000002" } }),
      row(3, { kind: "performance", metricName: "INP", durationMs: 40 }),
      row(3, { kind: "performance", at: now - 1000, received: now - 1000, metricName: "INP", durationMs: 200 })];
    const data = analyze(events, { from: new Date(now - 7200000).toISOString(), to: new Date(now - 1800000).toISOString() });
    expect(data.errorGroups).toHaveLength(2);
    expect(data.metrics.find(m => m.key === "INP")).toMatchObject({ n: 1, p50: 40 });
  });
});

it("separates exception categories when a controlled fingerprint is unavailable", () => {
  const data = analyze([
    row(1, { kind: "error", errorCode: "CLIENT_UNHANDLED", clientError: { category: "TypeError", source: "window_error" } }),
    row(2, { kind: "error", errorCode: "CLIENT_UNHANDLED", clientError: { category: "RangeError", source: "window_error" } }),
  ]);
  expect(data.errorGroups).toHaveLength(2);
  expect(data.errorGroups.map(g => g.category).sort()).toEqual(["RangeError", "TypeError"]);
});


it("separates v1/v2 cohorts, excludes censored timers and separates navigation from repeated demand", () => {
  const attemptId = id(900);
  const start = now - 2 * 86400000, end = start + 7200000;
  const events: EventRow[] = [
    row(800, { kind: "task", at: start, received: start, task: { name: "registration", definitionVersion: 1, attemptId, phase: "start", step: "start" } }),
    row(801, { kind: "task", at: end, received: end, durationMs: 3600000, task: { name: "registration", definitionVersion: 1, attemptId, phase: "complete", step: "confirm", activeMs: 3600000 } }),
    row(802, { kind: "task", at: start, received: start, task: { name: "registration", definitionVersion: 2, attemptId, phase: "start", step: "start" } }),
    row(803, { kind: "task", at: end, received: end, durationMs: 3600000, task: { name: "registration", definitionVersion: 2, attemptId, phase: "complete", step: "confirm", activeMs: 3600000, elapsedCensored: true, activeCensored: true } }),
    row(804, { kind: "ready", measurement, ready: { module: "match", phase: "advanced" }, durationMs: 900000 }),
    row(805, { kind: "ready", measurement, ready: { module: "match", phase: "advanced", basis: "demand" }, durationMs: 100 }),
    row(806, { kind: "ready", measurement, ready: { module: "match", phase: "advanced", basis: "demand" }, durationMs: 200 }),
  ];
  const data = AnalysisData.parse(analyze(events));
  const tasks = data.product.tasks.filter(t => t.key === "registration");
  expect(tasks.map(t => t.definitionVersion)).toEqual([1, 2]);
  expect(tasks[0]).toMatchObject({ completed: 1, elapsed: { n: 1 }, active: { n: 1 } });
  expect(tasks[1]).toMatchObject({ completed: 1, elapsedCensored: 1, activeCensored: 1, elapsed: { n: 0 }, active: { n: 0 } });
  expect(data.product.ready.find(r => r.basis === "navigation")).toMatchObject({ n: 1, p50: 900000 });
  expect(data.product.ready.find(r => r.basis === "demand")).toMatchObject({ n: 2, p50: 100, mean: 150 });
});


it("keeps confirmed completion through result steps, duplicate completion, cancellation and delivery order", () => {
  const attemptId = id(950), start = now - 2 * 86400000;
  const task = { name: "registration" as const, definitionVersion: 2 as const, attemptId, phase: "start" as const, step: "start" as const };
  const reports = [
    row(950, { kind: "task", at: start, received: start, task }),
    row(951, { kind: "task", at: start + 1000, received: start + 1000, durationMs: 1000, task: { ...task, phase: "complete", step: "confirm" } }),
    row(952, { kind: "task", at: start + 1200, received: start + 1200, durationMs: 1200, task: { ...task, phase: "step", step: "result" } }),
    row(953, { kind: "task", at: start + 2000, received: start + 2000, task: { ...task, phase: "cancel" } }),
  ];
  for (const events of [reports, [...reports].reverse(), [...reports, reports[1]]]) {
    const data = analyze(events).product.tasks.find(t => t.key === "registration" && t.definitionVersion === 2)!;
    expect(data).toMatchObject({ attempts: 1, completed: 1, cancelled: 0, elapsed: { n: 1, mean: 1000 } });
    expect(data.steps.find(s => s.key === "result")?.reached).toBe(1);
  }
});


it("does not censor a 100ms operation attached to a long task snapshot and ignores earlier active steps", () => {
  const start = now - 2 * 86400000, attemptId = id(990), operationId = id(995);
  const task = { name: "registration" as const, definitionVersion: 2 as const, attemptId, phase: "start" as const, step: "start" as const };
  const censored = { ...task, elapsedCensored: true as const, activeCensored: true as const, activeMs: 3600000 };
  const reports = [row(990, { kind: "task", at: start, received: start, task }),
    row(991, { kind: "task", at: start + 20000, received: start + 20000, durationMs: 20000, task: { ...task, phase: "step", step: "edit", activeMs: 10000 } }),
    row(992, { kind: "operation", operation: "register.submitRegistration", operationId, phase: "start", at: start + 7200000, received: start + 7200000, task: { ...censored, phase: "step", step: "submit" } }),
    row(993, { kind: "operation", operation: "register.submitRegistration", operationId, phase: "success", durationMs: 100, at: start + 7200100, received: start + 7200100, task: { ...censored, phase: "step", step: "submit" } }),
    row(994, { kind: "task", durationMs: 3600000, at: start + 7200100, received: start + 7200100, task: { ...censored, phase: "complete", step: "confirm" } }),
    row(995, { kind: "task", durationMs: 3600000, at: start + 7200200, received: start + 7200200, task: { ...censored, phase: "step", step: "result" } })];
  const data = analyze(reports).product;
  expect(data.operationTrends[0].successTiming).toMatchObject({ n: 1, mean: 100 });
  expect(data.tasks.find(t => t.key === "registration" && t.definitionVersion === 2)).toMatchObject({ completed: 1, elapsedCensored: 1, activeCensored: 1, elapsed: { n: 0 }, active: { n: 0 } });
});
