import { preservePublicStatsDependencyFailure } from "./availability";
import "server-only";
import { observePublicStatsFill } from "./public-fill";
import { observeStatsCacheFill, recordStatsCache } from "@/lib/observability/read-budget";

import { cacheLife, cacheTag } from "next/cache";
import { asc, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getTournamentPerformancePopulations } from "./tournament-query";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { compilePlayerAttributeBenchmark } from "./player-attributes";

async function cachedPlayerAttributeBenchmark() {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
  cacheTag(PUBLIC_STATS_TAG);
  return observeStatsCacheFill("benchmark", () => observePublicStatsFill("stats.benchmark", () => preservePublicStatsDependencyFailure(async () => {
    const events = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(ne(seasons.status, "draft"))
      .orderBy(asc(seasons.createdAt), asc(seasons.id));

    // One connection at a time, at most two events of source facts per snapshot.
    const populations = [];
    for (let offset = 0; offset < events.length; offset += 2) {
      populations.push(...await getTournamentPerformancePopulations(events.slice(offset, offset + 2).map(event => event.id)));
    }

    return compilePlayerAttributeBenchmark(populations.flat());
  })));
}

export async function getPlayerAttributeBenchmark() {
  recordStatsCache("benchmark", "readCalls");
  return cachedPlayerAttributeBenchmark();
}
