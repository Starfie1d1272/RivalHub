import type { Env } from "./index";
import { readHistory } from "./history";
import { readAnalysisSnapshot } from "./analysis";
import { ANALYSIS_BATCH_LIMIT, ANALYSIS_BYTES_LIMIT, analysisWindow, type AnalysisFilters } from "../../src/lib/telemetry/analysis-query";
import { historyCountFields, historyDefaults, historyDay, historyDayStart, historyBounds, emptyHistoryDistribution, mergeHistoryDistributions, type HistoryTimingRow } from "../../src/lib/telemetry/history-contract";
import type { LongWindowSummary } from "../../src/lib/telemetry/long-window-contract";
import { operationCalls, selectProductEvents, taskAttempts } from "../../src/lib/telemetry/product-analysis";
import { LIMITS } from "../../src/lib/telemetry/protocol";
import type { EventRow } from "../../src/lib/telemetry/analysis-model";
const DAY = 86400000;
function distribution(value?: number, metric = "") {
  const d = emptyHistoryDistribution(metric);
  if (value !== undefined) {
    d.n = 1; d.sum = value; d.min = value; d.max = value;
    const i = historyBounds(metric).findIndex(bound => value <= bound); d.counts[i < 0 ? d.counts.length - 1 : i] = 1;
  }
  return d;
}
function qualifiers(e: EventRow) {
  return { basis: e.kind === "ready" ? Reflect.get(e.ready ?? {}, "basis") === "demand" ? "demand" : "navigation" : "", elapsedCensored: e.kind === "task" && e.task?.elapsedCensored === true, activeCensored: e.kind === "task" && e.task?.activeCensored === true, reports: 1 };
}
/** Counts are observed additive facts; unknown coverage and unsupported distincts never become zero. */
export async function longWindowSummary(env: Env, f: AnalysisFilters, session: string, now: number, budget: { batches: number; bytes: number }): Promise<LongWindowSummary> {
  const window = analysisWindow(f, now);
  const counts = Object.fromEntries(historyCountFields.map(k => [k, 0])) as LongWindowSummary["counts"];
  const unsupported = ["browser", "source", "visibility", "scope", "navigationType"].filter(k => !!f[k as keyof AnalysisFilters]);
  if (session) unsupported.push("session");
  if (f.release && f.releaseBasis === "ticket") unsupported.push("ticketRelease");
  if (f.eventId === "missing") unsupported.push("eventIdMissing");
  const result: LongWindowSummary = { generatedAt: now, validUntil: now + 60000,
    requestedRange: { from: window.requestedFrom, to: window.requestedTo }, effectiveRange: { from: window.from, to: window.to },
    coveredRanges: [], source: "history+tail+raw_edges", coverage: { status: "partial", segments: [], pendingTailBatches: 0,
      tailBudgetTruncated: false, metricGroupsTruncated: false, rawBudgetTruncated: false, retentionUnknown: window.requestedFrom < now - 7 * DAY, seriesOmitted: true },
    counts, distinctSessions: null, distinctAccounts: null, metrics: [], unsupportedDimensions: unsupported };
  if (unsupported.length) {
    result.coverage.status = "unsupported";
    for (const k of historyCountFields) counts[k] = null;
    return result;
  }
  const metrics = new Map<string, HistoryTimingRow>();
  function addMetric(row: HistoryTimingRow) {
    const key = JSON.stringify([row.kind, row.name, row.phase, row.release, row.measurementVersion, row.definitionVersion, row.navigationType, Reflect.get(row, "basis") ?? (row.kind === "ready" ? "navigation" : ""), Reflect.get(row, "elapsedCensored") === true, Reflect.get(row, "activeCensored") === true]);
    const old = metrics.get(key);
    if (old) {
      Object.assign(old, { reports: Number(Reflect.get(old, "reports") ?? old.duration.n) + Number(Reflect.get(row, "reports") ?? row.duration.n) });
      old.duration = mergeHistoryDistributions([old.duration, row.duration], row.name);
      old.active = mergeHistoryDistributions([old.active, row.active]);
    } else if (metrics.size < 512) metrics.set(key, row);
    else result.coverage.metricGroupsTruncated = true;
  }
  const firstMidnight = historyDayStart(historyDay(window.from));
  const middleFrom = firstMidnight === window.from ? firstMidnight : firstMidnight + DAY;
  const middleTo = historyDayStart(historyDay(window.to));
  let rawBytes = ANALYSIS_BYTES_LIMIT, rawBatches = ANALYSIS_BATCH_LIMIT;
  if (middleFrom < middleTo) {
    // Existing history collapses exposure/start/complete into one attempt sample; total exposures are unrecoverable.
    counts.taskExposure = null;
    const history = await readHistory(env, { ...historyDefaults, days: "7", scene: f.scene, role: f.role, route: f.route, device: f.device, release: f.release, eventId: f.eventId, task: f.task, operation: f.operation }, now,
      { fromDay: historyDay(middleFrom), toDay: historyDay(middleTo - 1) });
    result.validUntil = Math.min(result.validUntil, history.validUntil ?? now + 60000);
    rawBytes -= history.coverage?.tailBytes ?? 0;
    rawBatches -= history.coverage?.tailBatches ?? 0;
    result.coverage.pendingTailBatches = history.pendingBatches;
    result.coverage.tailBudgetTruncated = history.coverage?.tailTruncated ?? false;
    result.coverage.metricGroupsTruncated = history.coverage?.timingRowsTruncated ?? history.truncated;
    const expected = (middleTo - middleFrom) / DAY;
    for (let at = middleFrom; at < middleTo; at += DAY) {
      const day = history.days.find(d => d.day === historyDay(at));
      const complete = !!day?.complete;
      result.coverage.segments.push({ from: at, to: at + DAY, source: "history+tail", status: complete ? "complete" : day ? "partial" : "unknown", reason: complete ? "" : !history.enabled ? "history_disabled" : !day ? "not_captured_or_retained" : result.coverage.tailBudgetTruncated ? "tail_budget" : "history_gap" });
      if (complete) result.coveredRanges.push({ from: at, to: at + DAY });
      if (day) for (const key of historyCountFields) if (counts[key] !== null) counts[key]! += day[key];
    }
    if (history.days.length < expected) result.coverage.retentionUnknown = true;
    history.timingRows.forEach(addMetric);
  }
  const edges = middleFrom >= middleTo ? [{ from: window.from, to: window.to }] : [
    ...(window.from < middleFrom ? [{ from: window.from, to: middleFrom }] : []),
    ...(middleTo < window.to ? [{ from: middleTo, to: window.to }] : []),
  ];
  const rawMetrics = new Map<string, EventRow>();
  for (const edge of edges) {
    const snapshot = await readAnalysisSnapshot(env.DB, { ...f, from: new Date(edge.from).toISOString(), to: new Date(edge.to).toISOString() }, now, budget, Math.max(0, rawBytes), Math.max(0, rawBatches), false, true);
    rawBytes -= snapshot.bytes; rawBatches -= snapshot.batches;
    // Read the actual edge before optional cohort followups, so a busy next day cannot evict its pages.
    if (edge.to < now && snapshot.events.some(e => e.received < edge.to && (e.kind === "operation" && e.phase === "start" || e.kind === "task" && e.task?.phase === "start"))) {
      const followup = await readAnalysisSnapshot(env.DB, { ...f, from: new Date(edge.to).toISOString(), to: new Date(Math.min(now, edge.to + DAY + LIMITS.ageMs)).toISOString() }, now, budget, Math.max(0, rawBytes), Math.max(0, rawBatches), false, true);
      rawBytes -= followup.bytes; rawBatches -= followup.batches;
      snapshot.events.push(...followup.events); snapshot.truncated ||= followup.truncated;
      snapshot.validUntil = Math.min(snapshot.validUntil, followup.validUntil);
    }
    result.validUntil = Math.min(result.validUntil, snapshot.validUntil);
    const latest = new Map<string, EventRow>();
    for (const e of snapshot.events) {
      const key = `${e.account ?? ""}:${e.session}:${e.kind === "performance" ? e.metricName : ""}:${e.id}`;
      const old = latest.get(key); if (!old || e.at > old.at || (e.at === old.at && e.received >= old.received)) latest.set(key, e);
    }
    const events = [...latest.values()];
    // Half-open segments avoid double-counting midnight between raw and aggregates.
    const rows = selectProductEvents(events, f, edge.from, edge.to).filter(e => e.received < edge.to || edge.to === window.to);
    const expiredRisk = edge.from < now - 7 * DAY + LIMITS.ageMs;
    const complete = !snapshot.truncated && !expiredRisk;
    result.coverage.rawBudgetTruncated ||= snapshot.truncated;
    result.coverage.retentionUnknown ||= expiredRisk;
    result.coverage.segments.push({ ...edge, source: "raw_edge", status: complete ? "complete" : "partial", reason: snapshot.truncated ? "raw_budget" : expiredRisk ? "raw_retention_boundary" : "" });
    if (complete) result.coveredRanges.push(edge);
    counts.views! += rows.filter(e => e.kind === "page").length;
    counts.errors! += rows.filter(e => e.kind === "error").length;
    const calls = operationCalls(events, rows);
    counts.operations! += calls.length;
    for (const c of calls) counts[c.result?.phase === "success" ? "success" : c.result?.phase === "rejected" ? "rejected" : c.result?.phase === "unknown" ? "unknown" : "pending"]!++;
    const attempts = taskAttempts(events, rows, now);
    counts.taskStarts! += attempts.length; counts.taskComplete! += attempts.filter(a => a.completed).length;
    if (counts.taskExposure !== null) counts.taskExposure += new Set(rows.filter(e => e.kind === "task" && e.task?.phase === "exposure").map(e => `${e.account}:${e.session}:${e.task!.definitionVersion}:${e.task!.attemptId}`)).size;
    function metric(e: EventRow, name: string, value?: number, active?: number) {
      addMetric(Object.assign({ kind: e.kind as HistoryTimingRow["kind"], name, phase: e.kind === "task" ? e.task?.phase ?? "" : e.phase ?? "", release: e.measurement?.clientRelease ?? "missing", measurementVersion: e.measurement?.v ?? 0, definitionVersion: e.task?.definitionVersion ?? 0,
        navigationType: e.measurement?.lifecycle?.navigationType ?? "missing", duration: distribution(e.kind === "task" && e.task?.elapsedCensored ? undefined : value, name), active: distribution(e.kind === "task" && e.task?.activeCensored ? undefined : active) }, qualifiers(e)));
    }
    const metricIds = new Set(snapshot.metricIds);
    const eligible = rows.filter(e => e.kind === "ready" || e.kind === "performance" && metricIds.has(e.id));
    const keys = JSON.stringify(eligible.flatMap(e => e.historyKey ? [e.historyKey] : []));
    const overlap = await env.DB.prepare("SELECT sample_key,day FROM history_samples WHERE expires>? AND sample_key IN (SELECT value FROM json_each(?))").bind(now, keys).all<{ sample_key: string; day: string }>();
    const middleKeys = new Set(overlap.results.filter(r => historyDayStart(r.day) >= middleFrom && historyDayStart(r.day) < middleTo).map(r => r.sample_key));
    for (const e of eligible) {
      if (e.historyKey && middleKeys.has(e.historyKey)) continue;
      const key = e.historyKey ?? `${e.session}:${e.id}`;
      const previous = rawMetrics.get(key);
      if (!previous || e.at > previous.at || e.at === previous.at && e.received >= previous.received) rawMetrics.set(key, e);
    }
    for (const c of calls) if (c.result) metric(c.result, c.start.operation!, c.result.durationMs);
    for (const a of attempts) if (a.completed) metric(a.candidates.find(e => e.task?.phase === "complete")!, a.start.task!.name, a.elapsed ?? undefined, a.active ?? undefined);
  }
  for (const e of rawMetrics.values()) addMetric(Object.assign({ kind: e.kind as HistoryTimingRow["kind"], name: e.kind === "ready" ? `${e.ready!.module}:${e.ready!.phase}` : e.metricName!, phase: "", release: e.measurement?.clientRelease ?? "missing", measurementVersion: e.measurement?.v ?? 0, definitionVersion: 0, navigationType: e.measurement?.lifecycle?.navigationType ?? "missing", duration: distribution(e.kind === "ready" || e.metricName !== "CLS" ? e.durationMs : e.score, e.metricName), active: emptyHistoryDistribution() }, qualifiers(e)));
  result.metrics = [...metrics.values()];
  result.coverage.status = result.coverage.segments.length > 0 && result.coverage.segments.every(s => s.status === "complete") ? "complete" : "partial";
  return result;
}
