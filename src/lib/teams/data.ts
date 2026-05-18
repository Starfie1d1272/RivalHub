import { db } from "@/db/client";
import { matchMaps, matchVetoSteps } from "@/db/schema";
import { and, inArray, eq } from "drizzle-orm";

interface MatchRef {
  id: string;
  teamAId: string;
  teamBId: string;
  format: string;
  scoreA: number | null;
  scoreB: number | null;
}

export interface MapWinStats {
  wins: number;
  played: number;
}

/** 每图胜率，兼容 BO1（via decider veto step）和 BO3/BO5（via matchMaps） */
export async function getTeamMapWinStats(
  teamId: string,
  teamMatches: MatchRef[],
): Promise<Map<string, MapWinStats>> {
  if (!teamMatches.length) return new Map();
  const matchRef = new Map(teamMatches.map((m) => [m.id, m]));
  const bo1Matches = teamMatches.filter((m) => m.format === "bo1");
  const bo35Matches = teamMatches.filter((m) => m.format !== "bo1");
  const mapStats = new Map<string, MapWinStats>();

  if (bo35Matches.length) {
    const maps = await db.query.matchMaps.findMany({
      where: inArray(matchMaps.matchId, bo35Matches.map((m) => m.id)),
    });
    for (const mp of maps) {
      if (mp.scoreA === null || mp.scoreB === null) continue;
      const match = matchRef.get(mp.matchId);
      if (!match) continue;
      const isA = match.teamAId === teamId;
      const myScore = isA ? mp.scoreA : mp.scoreB;
      const oppScore = isA ? mp.scoreB : mp.scoreA;
      const prev = mapStats.get(mp.mapName) ?? { wins: 0, played: 0 };
      mapStats.set(mp.mapName, {
        wins: prev.wins + (myScore > oppScore ? 1 : 0),
        played: prev.played + 1,
      });
    }
  }

  if (bo1Matches.length) {
    const deciders = await db
      .select({ matchId: matchVetoSteps.matchId, mapName: matchVetoSteps.mapName })
      .from(matchVetoSteps)
      .where(
        and(
          inArray(matchVetoSteps.matchId, bo1Matches.map((m) => m.id)),
          eq(matchVetoSteps.actionType, "decider"),
        ),
      );
    for (const d of deciders) {
      const match = matchRef.get(d.matchId);
      if (!match) continue;
      const isA = match.teamAId === teamId;
      const myScore = isA ? (match.scoreA ?? 0) : (match.scoreB ?? 0);
      const oppScore = isA ? (match.scoreB ?? 0) : (match.scoreA ?? 0);
      const prev = mapStats.get(d.mapName) ?? { wins: 0, played: 0 };
      mapStats.set(d.mapName, {
        wins: prev.wins + (myScore > oppScore ? 1 : 0),
        played: prev.played + 1,
      });
    }
  }

  return mapStats;
}

/** Ban 统计：返回每图 ban 次数 + 参与 BP 的对局总数（ban 率分母） */
export async function getTeamBanStats(
  teamId: string,
  matchIds: string[],
): Promise<{ banCount: Map<string, number>; bpMatchCount: number }> {
  if (!matchIds.length) return { banCount: new Map(), bpMatchCount: 0 };

  const [bpMatches, bans] = await Promise.all([
    db
      .selectDistinct({ matchId: matchVetoSteps.matchId })
      .from(matchVetoSteps)
      .where(inArray(matchVetoSteps.matchId, matchIds)),
    db
      .select({ mapName: matchVetoSteps.mapName })
      .from(matchVetoSteps)
      .where(
        and(
          inArray(matchVetoSteps.matchId, matchIds),
          eq(matchVetoSteps.actionType, "ban"),
          eq(matchVetoSteps.teamId, teamId),
        ),
      ),
  ]);

  const banCount = new Map<string, number>();
  for (const b of bans) {
    banCount.set(b.mapName, (banCount.get(b.mapName) ?? 0) + 1);
  }

  return { banCount, bpMatchCount: bpMatches.length };
}
