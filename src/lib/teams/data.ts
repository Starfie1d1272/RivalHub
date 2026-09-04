import { db } from "@/db/client";
import { matchMaps, matchVetoSteps } from "@/db/schema";
import { and, inArray, eq } from "drizzle-orm";

interface MatchRef {
  id: string;
  entryAId: string;
  entryBId: string;
  format: string;
  scoreA: number | null;
  scoreB: number | null;
}

export interface MapWinStats {
  wins: number;
  played: number;
}

/** 每图胜率：所有 format 均只统计 matchMaps 中实际完成的地图。 */
export async function getTeamMapWinStats(
  entryId: string,
  teamMatches: MatchRef[],
): Promise<Map<string, MapWinStats>> {
  if (!teamMatches.length) return new Map();
  const matchRef = new Map(teamMatches.map((m) => [m.id, m]));
  const mapStats = new Map<string, MapWinStats>();

  const maps = await db.query.matchMaps.findMany({
    where: inArray(matchMaps.matchId, teamMatches.map((m) => m.id)),
  });
  for (const mp of maps) {
    if (mp.scoreA === null || mp.scoreB === null) continue;
    const match = matchRef.get(mp.matchId);
    if (!match) continue;
    const isA = match.entryAId === entryId;
    const myScore = isA ? mp.scoreA : mp.scoreB;
    const oppScore = isA ? mp.scoreB : mp.scoreA;
    const prev = mapStats.get(mp.mapName) ?? { wins: 0, played: 0 };
    mapStats.set(mp.mapName, {
      wins: prev.wins + (myScore > oppScore ? 1 : 0),
      played: prev.played + 1,
    });
  }

  return mapStats;
}

async function getTeamVetoActionStats(
  entryId: string,
  matchIds: string[],
  actionType: "ban" | "pick",
): Promise<{ count: Map<string, number>; bpMatchCount: number }> {
  if (!matchIds.length) return { count: new Map(), bpMatchCount: 0 };

  const [bpMatches, actions] = await Promise.all([
    db
      .selectDistinct({ matchId: matchVetoSteps.matchId })
      .from(matchVetoSteps)
      .where(
        and(
          inArray(matchVetoSteps.matchId, matchIds),
          eq(matchVetoSteps.actionType, actionType),
        ),
      ),
    db
      .select({ mapName: matchVetoSteps.mapName })
      .from(matchVetoSteps)
      .where(
        and(
          inArray(matchVetoSteps.matchId, matchIds),
          eq(matchVetoSteps.actionType, actionType),
          eq(matchVetoSteps.entryId, entryId),
        ),
      ),
  ]);

  const count = new Map<string, number>();
  for (const a of actions) {
    count.set(a.mapName, (count.get(a.mapName) ?? 0) + 1);
  }

  return { count, bpMatchCount: bpMatches.length };
}

/** Ban 统计：返回每图 ban 次数 + 参与 BP 的对局总数（ban 率分母） */
export async function getTeamBanStats(
  entryId: string,
  matchIds: string[],
): Promise<{ banCount: Map<string, number>; bpMatchCount: number }> {
  const { count, bpMatchCount } = await getTeamVetoActionStats(entryId, matchIds, "ban");
  return { banCount: count, bpMatchCount };
}

/** Pick 统计：返回每图 pick 次数 + 参与 BP 的对局总数（pick 率分母） */
export async function getTeamPickStats(
  entryId: string,
  matchIds: string[],
): Promise<{ pickCount: Map<string, number>; bpMatchCount: number }> {
  const { count, bpMatchCount } = await getTeamVetoActionStats(entryId, matchIds, "pick");
  return { pickCount: count, bpMatchCount };
}
