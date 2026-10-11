import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { auditLogs, postMatchReports } from "@/db/schema";

/** Existing revoke facts preserve an explicit correction request; reads never submit a report. */
export async function readReopenedPostMatchIds(database: DB | TxDb, matchIds: readonly string[]) {
  if (!matchIds.length) return new Set<string>();
  const rows = await database.selectDistinct({
    matchId: auditLogs.targetId,
  }).from(auditLogs).where(and(inArray(auditLogs.targetId, [...matchIds]),
    eq(auditLogs.action, "postmatch.report.revoke"),
    sql`NOT EXISTS (SELECT 1 FROM ${postMatchReports} WHERE ${postMatchReports.matchId}::text = ${auditLogs.targetId})`));
  return new Set(rows.flatMap(row => row.matchId ? [row.matchId] : []));
}
