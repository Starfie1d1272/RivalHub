import "server-only";

import { asc, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getTournamentPerformancePlayers } from "./tournament-query";

export async function getPlayerAttributeBenchmarkPopulation() {
  const events = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(ne(seasons.status, "draft"))
    .orderBy(asc(seasons.createdAt), asc(seasons.id));

  const populations = await Promise.all(
    events.map((event) => getTournamentPerformancePlayers({ seasonId: event.id })),
  );

  return populations.flat();
}
