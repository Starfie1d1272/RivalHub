import { eq, and, or } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonRegistrations, teams } from "@/db/schema";
import { getMatchOrThrow } from "@/lib/action-utils";

/**
 * 获取队长所属的队伍 ID（用于 roster 提交和 scheduling 的队长身份校验）。
 * 链路：userId → seasonRegistrations.id → teams.captainRegistrationId。
 */
export async function getTeamIdForCaptain(
  userId: string,
  match: Awaited<ReturnType<typeof getMatchOrThrow>>,
): Promise<string | null> {
  const [reg] = await db
    .select({ id: seasonRegistrations.id })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.userId, userId),
        eq(seasonRegistrations.seasonId, match.seasonId),
      ),
    );
  if (!reg) return null;

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.captainRegistrationId, reg.id),
        or(eq(teams.id, match.teamAId), eq(teams.id, match.teamBId)),
      ),
    );

  if (!team) return null;
  return team.id === match.teamAId ? match.teamAId : match.teamBId;
}
