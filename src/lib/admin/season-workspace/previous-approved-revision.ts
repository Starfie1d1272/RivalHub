import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { competitionEntryRosterRevisions } from "@/db/schema";

/** Same predecessor as the prior full ascending history scan; never changes frozen source. */
export async function readPreviousApprovedRevisionIds(database: DB, entryIds: readonly string[]) {
  if (!entryIds.length) return new Map<string, string>();
  const ranked = database.select({
    id: competitionEntryRosterRevisions.id,
    entryId: competitionEntryRosterRevisions.entryId,
    position: sql<number>`row_number() over (partition by ${competitionEntryRosterRevisions.entryId} order by ${competitionEntryRosterRevisions.revisionNumber} desc)`.as("position"),
  }).from(competitionEntryRosterRevisions).where(and(inArray(competitionEntryRosterRevisions.entryId, [...entryIds]), isNotNull(competitionEntryRosterRevisions.approvedAt))).as("approved_history");
  const rows = await database.select({ id: ranked.id, entryId: ranked.entryId }).from(ranked)
    .where(eq(ranked.position, 2)).orderBy(asc(ranked.entryId));
  return new Map(rows.map(row => [row.entryId, row.id]));
}

