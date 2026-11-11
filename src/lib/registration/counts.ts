import "server-only";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { seasonRegistrations } from "@/db/schema";

/** An entrypoint must establish the season's visibility before showing these counts. */
export async function getRegistrationCounts(
  seasonId: string,
  database: DB | TxDb = db,
  excludeRegistrationId?: string,
) {
  const rows = await database
    .select({
      position: seasonRegistrations.primaryPosition,
      count: count(),
      approved:
        sql<number>`count(*) filter (where ${seasonRegistrations.status} = 'approved')`.mapWith(
          Number,
        ),
    })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        ne(seasonRegistrations.status, "rejected"),
        excludeRegistrationId ? ne(seasonRegistrations.id, excludeRegistrationId) : undefined,
      ),
    )
    .groupBy(seasonRegistrations.primaryPosition);
  return {
    positionCounts: Object.fromEntries(rows.map((row) => [row.position, row.count])),
    approvedPositionCounts: Object.fromEntries(rows.map((row) => [row.position, row.approved])),
    approvedCount: rows.reduce((total, row) => total + row.approved, 0),
  };
}
