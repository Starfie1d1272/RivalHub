import type { EventRow } from "./analysis-model";
import type { AnalysisFilters } from "./analysis-query";
import type { ProductAnalysis, Timing } from "./product-analysis-contract";
import { metricLabels, opName, routeName, readyModules, readyPhases } from "./analysis-presentation";
import { TASKS, TASK_NAMES, TASK_VALIDATION_REASONS, taskForOperation, taskForRoute, type TaskName } from "./task-contract";

export function timing(values: number[]): Timing {
  const xs = values.filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const at = (q: number) => xs.length ? xs[Math.max(0, Math.ceil(xs.length * q) - 1)] : null;
  return { n: xs.length, mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    p50: at(.5), p75: at(.75), p90: at(.9), p95: at(.95), max: xs.at(-1) ?? null };
}
export function eventTask(e: EventRow): TaskName | undefined {
  return e.task?.name ?? (e.operation ? taskForOperation(e.operation) : taskForRoute(e.route));
}
export function eventRelease(e: EventRow, basis: string): string {
  return basis === "ticket" ? e.release : e.measurement?.clientRelease ?? "missing";
}
export function selectProductEvents(events: EventRow[], f: AnalysisFilters, from: number, to: number) {
  return events.filter(e => e.received >= from && e.received <= to &&
    (!f.scene || e.scene === f.scene) && (!f.role || e.role === f.role) && (!f.route || e.route === f.route) &&
    (!f.release || eventRelease(e, f.releaseBasis) === f.release) &&
    (!f.device || (e.client?.device ?? "missing") === f.device) &&
    (!f.browser || (e.client?.browser ?? "missing") === f.browser) &&
    (!f.source || (e.client?.source ?? "missing") === f.source) &&
    (!f.scope || e.route.startsWith("/admin") === (f.scope === "admin")) &&
    (!f.eventId || (e.eventId ?? "missing") === f.eventId) &&
    (!f.task || eventTask(e) === f.task) && (!f.operation || e.operation === f.operation) &&
    (!f.navigationType || (e.measurement?.lifecycle?.navigationType ?? "missing") === f.navigationType) &&
    (!f.visibility || (e.measurement?.visibility ?? "missing") === f.visibility));
}
export function bucketStart(at: number, step: number) {
  const offset = 8 * 3600000;
  return Math.floor((at + offset) / step) * step - offset;
}
export function operationKey(e: EventRow) {
  return `${e.account ?? ""}:${e.session}:${e.operation ?? ""}:${e.operationId ?? ""}`;
}
const taskKey = (e: EventRow) => `${e.account ?? ""}:${e.session}:${e.task?.name}:${e.task?.definitionVersion}:${e.task?.attemptId}`;
function group<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, T[]>();
  for (const row of rows) { const k = key(row); const bucket = result.get(k); if (bucket) bucket.push(row); else result.set(k, [row]); }
  return [...result.entries()];
}
const latest = (a: EventRow, b: EventRow) => b.at - a.at || b.received - a.received || a.id.localeCompare(b.id);
export function operationCalls(events: EventRow[], rows: EventRow[]) {
  const calls = new Map(group(events.filter(e => e.kind === "operation" && e.operationId), operationKey));
  return group(rows.filter(e => e.kind === "operation" && e.phase === "start" && e.operationId), operationKey).map(([, starts]) => {
    const start = starts.sort((a, b) => -latest(a, b))[0];
    return { start, result: (calls.get(operationKey(start)) ?? []).filter(e => e.phase !== "start" && e.at >= start.at).sort(latest)[0] };
  });
}

const duration = (e?: EventRow) => typeof e?.durationMs === "number" ? [e.durationMs] : [];
const unique = (rows: EventRow[]) => new Set(rows.map(e => e.session)).size;
const navigationNames: Record<string, string> = { hard: "首次加载与刷新", soft: "站内导航", bfcache: "页面恢复", prerender: "预渲染激活", unknown: "导航类型未知", missing: "未采集" };

export function analyzeProduct(
  events: EventRow[], rows: EventRow[], metricIds: Set<string>, f: AnalysisFilters,
  window: ProductAnalysis["window"], capturedAt: number,
  releaseDirectoryTruncated = false,
): ProductAnalysis {
  const times: number[] = [];
  for (let at = bucketStart(window.from, window.step); at <= window.to; at += window.step) times.push(at);
  const inBucket = (e: EventRow, at: number) => e.received >= at && e.received < at + window.step;
  const calls = operationCalls(events, rows);
  type Call = typeof calls[number];
  const callResults = (cs: Call[]) => ({
    start: cs.length, success: cs.filter(c => c.result?.phase === "success").length,
    rejected: cs.filter(c => c.result?.phase === "rejected").length,
    unknown: cs.filter(c => c.result?.phase === "unknown").length,
    pending: cs.filter(c => !c.result).length,
  });
  const callTimings = (cs: Call[]) => ({
    successTiming: timing(cs.flatMap(c => c.result?.phase === "success" ? duration(c.result) : [])),
    otherTiming: timing(cs.flatMap(c => c.result && c.result.phase !== "success" ? duration(c.result) : [])),
  });
  const operationGroups = group(calls, c => c.start.operation!).sort((a, b) => b[1].length - a[1].length);
  const taskGroups = new Map(group(events.filter(e => e.task), taskKey));
  const attempts = group(rows.filter(e => e.kind === "task" && e.task?.phase === "start"), taskKey).map(([, starts]) => {
    const start = starts.sort((a, b) => -latest(a, b))[0];
    const candidates = (taskGroups.get(taskKey(start)) ?? []).filter(e => e.at >= start.at).sort((a, b) => -latest(a, b));
    const limit = TASKS[start.task!.name].windowMs;
    const confirmed = candidates.find(e => e.kind === "task" && e.task!.phase === "complete" && e.at <= start.at + limit);
    const end = confirmed ?? candidates.find(e => e.kind === "task" && e.task!.phase === "cancel" && e.at <= start.at + limit);
    const completed = end?.task?.phase === "complete";
    const cancelled = end?.task?.phase === "cancel";
    const matured = capturedAt >= start.received + limit;
    const elapsed = completed && end ? end.at - start.at : null;
    const active = completed && end && typeof end.task?.activeMs === "number" ? Math.min(end.task.activeMs, elapsed!) : null;
    return { start, candidates, completed, cancelled, matured, elapsed, active, elapsedCensored: end?.task?.elapsedCensored === true, activeCensored: end?.task?.activeCensored === true,
      late: !end && candidates.some(e => e.task?.phase === "complete" && e.at > start.at + limit) };
  });
  type Attempt = typeof attempts[number];
  const attemptResults = (as: Attempt[]) => {
    const matured = as.filter(a => a.matured).length;
    const maturedCompleted = as.filter(a => a.matured && a.completed).length;
    return { attempts: as.length, matured, maturedCompleted,
      completed: as.filter(a => a.completed).length, cancelled: as.filter(a => a.cancelled).length,
      unobserved: as.filter(a => a.matured && !a.completed && !a.cancelled).length,
      inProgress: as.filter(a => !a.matured && !a.completed && !a.cancelled).length,
      completionPct: matured ? maturedCompleted / matured * 100 : null };
  };
  // Match the completion-rate cohort: only completed attempts with a full observation window.
  const attemptTimings = (all: Attempt[]) => { const as = all.filter(a => a.matured); return ({
    elapsedCensored: as.filter(a => a.completed && a.elapsedCensored).length,
    activeCensored: as.filter(a => a.completed && a.activeCensored).length,
    elapsed: timing(as.flatMap(a => a.elapsed === null || a.elapsedCensored ? [] : [a.elapsed])),
    active: timing(as.flatMap(a => a.active === null || a.activeCensored ? [] : [a.active])),
  }); };
  const readyRows = [...new Map(group(rows.filter(e => e.kind === "ready" && e.ready && e.measurement?.navigationId),
    e => `${e.account ?? ""}:${e.session}:${e.measurement!.navigationId}:${e.route}:${e.ready!.module}:${e.ready!.phase}:${e.ready!.basis ?? "navigation"}:${e.ready!.basis === "demand" ? e.id : ""}`)
    .map(([key, rr]) => [key, rr.sort((a, b) => a.at - b.at)[0]])).values()];
  const readyGroups = group(readyRows, e => `${e.route}|${e.ready!.module}|${e.ready!.phase}|${e.ready!.basis ?? "navigation"}`).sort((a, b) => b[1].length - a[1].length);
  const performance = rows.filter(e => e.kind === "performance" && metricIds.has(e.id) && (e.metricName === "CLS" ? typeof e.score === "number" : typeof e.durationMs === "number"));
  const sampleValues = (rr: EventRow[]) => rr.flatMap(e => e.metricName === "CLS" ? typeof e.score === "number" ? [e.score] : [] : duration(e));
  const pages = rows.filter(e => e.kind === "page");
  return {
    window,
    coverage: { reports: rows.length, enhanced: rows.filter(e => e.measurement).length,
      pages: pages.length, enhancedPages: pages.filter(e => e.measurement).length,
      clientClassifiedPages: pages.filter(e => e.client).length,
      ready: readyRows.length, task: rows.filter(e => e.kind === "task").length,
      clientVersionMissing: rows.filter(e => !e.measurement?.clientRelease || e.measurement.clientRelease === "unknown").length,
      firstEnhancedAt: rows.filter(e => e.measurement).reduce<number | null>((n, e) => n === null ? e.received : Math.min(n, e.received), null) },
    tasks: TASK_NAMES.filter(name => !f.task || name === f.task).flatMap(key => ([1, 2, 0] as const).filter(version => version === 1 || rows.some(e => eventTask(e) === key && (e.task?.definitionVersion ?? 0) === version)).map(definitionVersion => {
      const definition = TASKS[key];
      const rr = rows.filter(e => eventTask(e) === key && (e.task?.definitionVersion ?? 0) === definitionVersion);
      const cs = calls.filter(c => eventTask(c.start) === key && (c.start.task?.definitionVersion ?? 0) === definitionVersion);
      const as = attempts.filter(a => a.start.task!.name === key && a.start.task!.definitionVersion === definitionVersion);
      const exposures = rr.filter(e => e.kind === "task" && e.task?.phase === "exposure");
      // Account identifiers exist only during this bounded raw-history calculation.
      // A use is a task start or content page view, not background performance delivery.
      const uses = rr.filter(e => (e.kind === "task" && e.task?.phase === "start") || (key === "content" && e.kind === "page"));
      const accountDays = group(uses.filter(e => !!e.account), e => e.account!).map(([, rs]) => new Set(rs.map(e => bucketStart(e.received, 86400000))).size);
      const validationLabels = { required: "必填项缺失", password_policy: "密码不符合要求", password_mismatch: "两次密码不一致", form_invalid: "表单未通过检查", file_type: "文件类型不支持", file_size: "文件过大", server_validation: "服务端未通过检查" };
      const validations = TASK_VALIDATION_REASONS.map(reason => {
        const matching = as.map(a => a.candidates.filter(e => e.task?.step === "validation" && e.task.validationReason === reason && e.at <= a.start.at + definition.windowMs));
        return { reason, label: validationLabels[reason], reports: matching.reduce((n, es) => n + es.length, 0), attempts: matching.filter(es => es.length).length };
      }).filter(v => v.reports);
      return { key, label: definition.label, definitionVersion, windowMs: definition.windowMs,
        views: rr.filter(e => e.kind === "page").length, sessions: unique(rr),
        eligibleExposures: group(exposures, taskKey).length, eligibleSessions: unique(exposures),
        repeatUsage: { accounts: accountDays.length, repeatedAccounts: accountDays.filter(n => n >= 2).length,
          accountDays: accountDays.reduce((a, b) => a + b, 0), unlinkedReports: uses.filter(e => !e.account).length,
          basis: "selected_window_distinct_beijing_days" as const }, validations,
        ...callResults(cs), ...attemptResults(as), ...attemptTimings(as),
        steps: definition.steps.map(step => {
          const durations: number[] = [];
          let reached = 0;
          for (const a of as) {
            const e = a.candidates.find(e => e.task?.step === step.key);
            if (!e) continue;
            reached++;
            const next = a.candidates.find(n => n.at > e.at && n.task?.step !== step.key);
            if (next && next.at <= a.start.at + definition.windowMs) durations.push(next.at - e.at);
          }
          return { key: step.key, label: step.label, reached, elapsed: timing(durations) };
        }),
        trend: rr.length && definitionVersion !== 0 ? times.map(at => { const aa = as.filter(a => inBucket(a.start, at)); return { at, ...attemptResults(aa), ...attemptTimings(aa), ...callResults(cs.filter(c => inBucket(c.start, at))) }; }) : [],
      };
    })),
    operationTrends: operationGroups.slice(0, 12).map(([operation, cs]) => ({
      operation, label: opName(operation), task: taskForOperation(operation) ?? "", ...callResults(cs), ...callTimings(cs),
      points: times.map(at => { const cc = cs.filter(c => inBucket(c.start, at)); return { at, ...callResults(cc), ...callTimings(cc) }; }),
    })),
    performanceTrends: Object.entries(metricLabels).map(([metric, label]) => ({ metric, label,
      points: times.map(at => ({ at, ...timing(sampleValues(performance.filter(e => e.metricName === metric && inBucket(e, at)))) })),
    })),
    ready: readyGroups.slice(0, 60).map(([, rr], i) => ({
      basis: rr[0].ready!.basis ?? "navigation", route: rr[0].route, label: routeName(rr[0].route), module: rr[0].ready!.module,
      moduleLabel: readyModules[rr[0].ready!.module] ?? "其他内容", phase: rr[0].ready!.phase,
      phaseLabel: readyPhases[rr[0].ready!.phase] ?? "内容可用", ...timing(rr.flatMap(duration)),
      points: i < 12 ? times.map(at => ({ at, ...timing(rr.filter(e => inBucket(e, at)).flatMap(duration)) })) : [],
    })),
    releases: (["client", "ticket"] as const).flatMap(basis => group(rows, e => eventRelease(e, basis)).map(([release, rr]) => ({ release, basis, reports: rr.length }))),
    lifecycle: group(rows, e => e.measurement?.lifecycle?.navigationType ?? "missing").map(([key, rr]) => ({ key, label: navigationNames[key] ?? "导航类型未知", reports: rr.length })),
    quality: { operationSeriesTruncated: operationGroups.length > 12, readySeriesTruncated: readyGroups.length > 12,
      releaseDirectoryTruncated, orphanTaskReports: rows.filter(e => e.kind === "task" && e.task?.phase !== "exposure" && !(taskGroups.get(taskKey(e)) ?? []).some(s => s.task?.phase === "start")).length,
      lateTaskCompletions: attempts.filter(a => a.late).length, readyWithoutNavigation: rows.filter(e => e.kind === "ready" && !e.measurement?.navigationId).length },
  };
}
