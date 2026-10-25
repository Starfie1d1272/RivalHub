import { z } from "zod";
const count = z.number().int().nonnegative();
const value = z.number().finite().nonnegative();
const text = z.string().max(256);
export const TimingData = z.object({
  n: count, mean: value.nullable(), p50: value.nullable(), p75: value.nullable(),
  p90: value.nullable(), p95: value.nullable(), max: value.nullable(),
});
export type Timing = z.infer<typeof TimingData>;
const results = { start: count, success: count, rejected: count, unknown: count, pending: count };
const timingPoint = z.object({ at: count, ...TimingData.shape });
const attemptResults = {
  attempts: count, matured: count, maturedCompleted: count, completed: count, cancelled: count,
  unobserved: count, inProgress: count, completionPct: value.nullable(),
};
export const ProductAnalysisData = z.object({
  window: z.object({
    from: count, to: count, requestedFrom: count, requestedTo: count,
    retentionClipped: z.boolean(), step: count, timeZone: z.literal("Asia/Shanghai"),
  }),
  coverage: z.object({
    reports: count, enhanced: count, pages: count, enhancedPages: count,
    clientClassifiedPages: count, ready: count, task: count, clientVersionMissing: count,
    firstEnhancedAt: count.nullable(),
  }),
  tasks: z.array(z.object({
    key: text, label: text, definitionVersion: count, windowMs: count,
    views: count, sessions: count, eligibleExposures: count, eligibleSessions: count, ...results, ...attemptResults,
    repeatUsage: z.object({ accounts: count, repeatedAccounts: count, accountDays: count, unlinkedReports: count, basis: z.literal("selected_window_distinct_beijing_days") }),
    validations: z.array(z.object({ reason: text, label: text, reports: count, attempts: count })).max(7),
    elapsedCensored: count.optional(), activeCensored: count.optional(),
    elapsed: TimingData, active: TimingData,
    steps: z.array(z.object({ key: text, label: text, reached: count, elapsed: TimingData })).max(30),
    trend: z.array(z.object({ at: count, ...attemptResults, elapsedCensored: count.optional(), activeCensored: count.optional(), elapsed: TimingData, active: TimingData, ...results })).max(169),
  })).max(40),
  operationTrends: z.array(z.object({
    operation: text, label: text, task: text, ...results,
    successTiming: TimingData, otherTiming: TimingData,
    points: z.array(z.object({ at: count, ...results, successTiming: TimingData, otherTiming: TimingData })).max(169),
  })).max(12),
  performanceTrends: z.array(z.object({
    metric: text, label: text, points: z.array(timingPoint).max(169),
  })).max(6),
  ready: z.array(z.object({
    basis: z.enum(["navigation", "demand"]).optional(), route: text, label: text, module: text, moduleLabel: text, phase: text, phaseLabel: text,
    ...TimingData.shape, points: z.array(timingPoint).max(169),
  })).max(60),
  releases: z.array(z.object({
    release: text, basis: z.enum(["client", "ticket"]), reports: count,
  })).max(4000),
  lifecycle: z.array(z.object({ key: text, label: text, reports: count })).max(10),
  quality: z.object({
    operationSeriesTruncated: z.boolean(), readySeriesTruncated: z.boolean(),
    releaseDirectoryTruncated: z.boolean(), orphanTaskReports: count,
    lateTaskCompletions: count, readyWithoutNavigation: count,
  }),
});
export type ProductAnalysis = z.infer<typeof ProductAnalysisData>;
