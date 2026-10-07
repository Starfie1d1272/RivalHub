import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, matchMaps } from "@/db/schema";
import { validateSeriesAgainstMaps } from "./result-rules";
import { concludeMatchExecution } from "./execution";

/** Persists match facts only. Event advancement is performed by the competition adapter. */
export async function persistCompletedMatchInTx(tx: TxDb, input: {
  match: typeof matches.$inferSelect; scoreA: number; scoreB: number;
  completedAt: Date; preserveMapPlans?: boolean;
}) {
  if (input.match.seasonId === null) {
    const facts = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, input.match.id));
    validateSeriesAgainstMaps(input.match.format, input.scoreA, input.scoreB, facts);
  }
  const conclusion = concludeMatchExecution(input.match, { kind: "recorded", scoreA: input.scoreA, scoreB: input.scoreB }, input.completedAt);
  if (!input.preserveMapPlans) await tx.delete(matchMaps).where(and(eq(matchMaps.matchId, input.match.id), isNull(matchMaps.scoreA), isNull(matchMaps.scoreB)));
  await tx.update(matches).set({ ...(input.match.seasonId === null ? { resultDisposition: "recorded" as const } : {}), status: conclusion.status, scoreA: conclusion.scoreA, scoreB: conclusion.scoreB, completedAt: conclusion.completedAt, updatedAt: new Date() }).where(eq(matches.id, input.match.id));
}
