import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries } from "@/db/schema";
import { publicCompetitionEntryCondition } from "./public-visibility";

export async function getApprovedCompetitionEntryCount(seasonId: string) {
  const [row] = await db.select({ value: count() }).from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, seasonId), publicCompetitionEntryCondition()));
  return Number(row?.value ?? 0);
}

/** Draft administration includes formed entries regardless of public approval. */
export async function getFormedCompetitionEntryCount(seasonId: string) {
  const [row] = await db.select({ value: count() }).from(competitionEntries)
    .where(eq(competitionEntries.competitionId, seasonId));
  return Number(row?.value ?? 0);
}
