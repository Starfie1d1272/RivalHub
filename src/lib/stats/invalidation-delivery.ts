import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { statisticsInvalidation } from "@/db/schema";
import { revalidatePublicStatsTag } from "@/lib/revalidation";

/** Deliver after commit; a newer generation must never be acknowledged. */
export async function deliverStatisticsInvalidation(): Promise<"complete" | "pending"> {
  const [pending] = await db.select({ generation: statisticsInvalidation.generation })
    .from(statisticsInvalidation)
    .where(and(eq(statisticsInvalidation.id, "global"), gt(statisticsInvalidation.generation, statisticsInvalidation.publishedGeneration)))
    .limit(1);
  if (!pending) return "complete";
  revalidatePublicStatsTag("stats.projection_rebuild");
  const acknowledged = await db.update(statisticsInvalidation).set({ publishedGeneration: pending.generation })
    .where(and(eq(statisticsInvalidation.id, "global"), eq(statisticsInvalidation.generation, pending.generation)))
    .returning({ id: statisticsInvalidation.id });
  return acknowledged.length ? "complete" : "pending";
}
