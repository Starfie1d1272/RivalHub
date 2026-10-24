import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matchRosters, matchRosterPlayers } from "@/db/schema";

type Roster = typeof matchRosters.$inferSelect & { players: (typeof matchRosterPlayers.$inferSelect)[] };

/** Visible match callers share one scoped read of both frozen/submitted lineups. */
export async function loadMatchRosters(matchId: string, entryIds: readonly string[], executor: Pick<TxDb, "select"> = db) {
  const result = new Map<string, Roster>();
  if (!entryIds.length) return result;
  const rows = await executor.select({ roster: matchRosters, player: matchRosterPlayers })
    .from(matchRosters).leftJoin(matchRosterPlayers, eq(matchRosterPlayers.rosterId, matchRosters.id))
    .where(and(eq(matchRosters.matchId, matchId), inArray(matchRosters.entryId, [...entryIds])));
  for (const { roster, player } of rows) {
    let current = result.get(roster.entryId);
    if (!current) { current = { ...roster, players: [] }; result.set(roster.entryId, current); }
    if (player) current.players.push(player);
  }
  return result;
}
