import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { asc, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getTournamentPerformancePlayers } from "./tournament-query";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { compilePlayerAttributeBenchmark } from "./player-attributes";
import { traceOperation } from "@/lib/observability/server";

export async function getPlayerAttributeBenchmark() {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
  cacheTag(PUBLIC_STATS_TAG);
  return traceOperation("stats.public.read", { scope: "statistics", operation: "benchmark" }, async () => {
    const events = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(ne(seasons.status, "draft"))
      .orderBy(asc(seasons.createdAt), asc(seasons.id));

    // Bound connection usage while retaining one observation per player per event.
    const populations = [];
    for (const event of events) {
      populations.push(await getTournamentPerformancePlayers({ seasonId: event.id }));
    }

    return compilePlayerAttributeBenchmark(populations.flat());
  });
}
