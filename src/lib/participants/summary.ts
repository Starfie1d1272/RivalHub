import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonRegistrations, teamMembers } from "@/db/schema";
import type { Season } from "@/db/schema/seasons";

/** Public participant truth follows the season's registration capability. */
export async function getParticipantSummary(season: Pick<Season, "id" | "registrationMode">): Promise<{ count: number; hasPlayers: boolean }> {
  const [row] = season.registrationMode === "team"
    ? await db.select({ value: count() }).from(teamMembers).where(eq(teamMembers.seasonId, season.id))
    : await db.select({ value: count() }).from(seasonRegistrations).where(and(eq(seasonRegistrations.seasonId, season.id), eq(seasonRegistrations.status, "approved")));
  const total = Number(row?.value ?? 0);
  return { count: total, hasPlayers: total > 0 };
}
