import { z } from "zod";
import { HistoryTimingRow, historyCountFields } from "./history-contract";
const count = z.number().int().nonnegative();
const range = z.object({ from: count, to: count });
export const LongWindowSummary = z.object({
  generatedAt: count, validUntil: count, completionBasis: z.literal("observed_not_matured"), requestedRange: range, effectiveRange: range,
  coveredRanges: z.array(range).max(10), source: z.literal("history+tail+raw_edges"),
  coverage: z.object({ status: z.enum(["complete", "partial", "unsupported"]),
    segments: z.array(range.extend({ source: z.enum(["history+tail", "raw_edge"]), status: z.enum(["complete", "partial", "unknown"]), reason: z.string().max(80) })).max(10),
    pendingTailBatches: count, tailBudgetTruncated: z.boolean(), metricGroupsTruncated: z.boolean(),
    rawBudgetTruncated: z.boolean(), retentionUnknown: z.boolean(), seriesOmitted: z.boolean(),
  }),
  counts: z.object(Object.fromEntries(historyCountFields.map(k => [k, count.nullable()])) as Record<typeof historyCountFields[number], z.ZodNullable<typeof count>>),
  distinctSessions: count.nullable(), distinctAccounts: count.nullable(),
  metrics: z.array(HistoryTimingRow).max(512), unsupportedDimensions: z.array(z.string().max(80)).max(20),
});
export type LongWindowSummary = z.infer<typeof LongWindowSummary>;
