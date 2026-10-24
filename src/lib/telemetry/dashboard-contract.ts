import { z } from "zod";
import { CLIENT_CATEGORIES } from "./client-context-contract";
import { OPERATIONS } from "./operations";
import { ROUTES } from "./routes";

const count = z.number().int().nonnegative();
export const DashboardData = z.object({
  generatedAt: count, validUntil: count, from: count, sampledBatches: count, legacyPerformanceReports: count, truncated: z.boolean(), latestReceived: count.nullable(),
  totals: z.object({ page: count, filter: count, error: count, start: count, success: count, rejected: count, unknown: count }),
  trend: z.array(z.object({ at: count, page: count, start: count, error: count })).max(169),
  routes: z.array(z.object({ route: z.string().max(160), pages: count, errors: count })).max(ROUTES.length + 1),
  operations: z.array(z.object({ operation: z.string().max(160), start: count, success: count, rejected: count, unknown: count, durationMs: count })).max(OPERATIONS.length),
  performance: z.array(z.object({ route: z.string().max(160), metric: z.enum(["TTFB", "FCP", "LCP", "INP", "NAV_COMMIT", "CLS"]), reports: count, durationMs: count, score: z.number().nonnegative().optional() })).max((ROUTES.length + 1) * 6),
  clients: z.array(z.object({ dimension: z.enum(["device", "browser", "os", "source"]), value: z.string(), pages: count }).refine(row => (CLIENT_CATEGORIES[row.dimension] as readonly string[]).includes(row.value))).max(100),
  usage: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), batches: count, bytes: count })).max(8),
  budget: z.object({ batches: count, bytes: count }),
  cleanup: z.object({ expiredBatches: count, oldestExpiry: count.nullable() }),
});
export type DashboardData = z.infer<typeof DashboardData>;
