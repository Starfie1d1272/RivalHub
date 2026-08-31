import { eq, and, or } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries } from "@/db/schema";
import { getMatchOrThrow } from "@/lib/action-utils";

/**
 * 获取队长所属的队伍 ID（用于 roster 提交和 scheduling 的队长身份校验）。
 * 链路：userId → competitionEntries.representativeUserId（canonical identity bridge）。
 * 必须同时满足：captain identity + match participant + same season（defense-in-depth）。
 */
export async function getEntryIdForRepresentative(
  userId: string,
  match: Awaited<ReturnType<typeof getMatchOrThrow>>,
): Promise<string | null> {
  const [team] = await db
    .select({ id: competitionEntries.id })
    .from(competitionEntries)
    .where(
      and(
        eq(competitionEntries.representativeUserId, userId),
        eq(competitionEntries.competitionId, match.seasonId),
        or(eq(competitionEntries.id, match.entryAId), eq(competitionEntries.id, match.entryBId)),
      ),
    );

  if (!team) return null;
  return team.id === match.entryAId ? match.entryAId : match.entryBId;
}
