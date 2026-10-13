import "server-only";
import { inArray } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matchMaps } from "@/db/schema";
import { projectDisplayScore, type DisplayScoreMap, type DisplayScoreMatch } from "./display-score";

/** One bounded batch; no scoreboard, demo, roster or live snapshot payloads. */
export async function withDisplayScores<T extends DisplayScoreMatch & { id: string }>(rows: readonly T[], executor: Pick<TxDb, "select"> = db) {
  const ids = [...new Set(rows.filter(row => row.format === "bo1" && row.status === "finished" && !row.isForfeit &&
    (!row.resultDisposition || row.resultDisposition === "recorded")).map(row => row.id))];
  const maps = ids.length ? await executor.select({ matchId: matchMaps.matchId, mapOrder: matchMaps.mapOrder,
    scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB, completedAt: matchMaps.completedAt })
    .from(matchMaps).where(inArray(matchMaps.matchId, ids)) : [];
  const byMatch = new Map<string, DisplayScoreMap[]>();
  for (const map of maps) { const list = byMatch.get(map.matchId) ?? []; list.push(map); byMatch.set(map.matchId, list); }
  return rows.map(row => ({ ...row, displayScore: projectDisplayScore(row, byMatch.get(row.id)) }));
}
