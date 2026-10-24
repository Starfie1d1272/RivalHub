import { db, type TxDb } from "@/db/client";
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
  const rows = await db.query.matchMaps.findMany({
    where: inArray(matchMaps.matchId, teamMatches.map((m) => m.id)),
    columns: { matchId: true, mapName: true, scoreA: true, scoreB: true },
  });
  return projectMapWinStats(entryId, teamMatches, rows);
}

function projectMapWinStats(entryId: string, teamMatches: MatchRef[], rows: MapFact[]) {
  const matchRef = new Map(teamMatches.map(match => [match.id, match]));
  const mapStats = new Map<string, MapWinStats>();
  for (const mp of rows) {
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

  const actions = await db.select({ matchId: matchVetoSteps.matchId, entryId: matchVetoSteps.entryId, mapName: matchVetoSteps.mapName })
    .from(matchVetoSteps).where(and(inArray(matchVetoSteps.matchId, matchIds), eq(matchVetoSteps.actionType, actionType)));
  return projectVetoStats(entryId, new Set(matchIds), actions);
}

type MapFact = Pick<typeof matchMaps.$inferSelect, "matchId" | "mapName" | "scoreA" | "scoreB">;
type VetoFact = Pick<typeof matchVetoSteps.$inferSelect, "matchId" | "entryId" | "mapName">;
function projectVetoStats(entryId: string, matchIds: ReadonlySet<string>, actions: VetoFact[]) {
  const count = new Map<string, number>();
  const bpMatches = new Set<string>();
  for (const a of actions) {
    if (!matchIds.has(a.matchId)) continue;
    bpMatches.add(a.matchId);
    if (a.entryId !== entryId) continue;
    count.set(a.mapName, (count.get(a.mapName) ?? 0) + 1);
  }

  return { count, bpMatchCount: bpMatches.size };
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

/** Both opponents share one map batch and one BP batch, with per-team sample scopes. */
export async function getTeamMapProfiles(
  scopes: readonly { entryId: string; matches: MatchRef[] }[],
  executor: Pick<TxDb, "select"> = db,
) {
  const ids = [...new Set(scopes.flatMap(scope => scope.matches.map(match => match.id)))];
  const [maps, steps] = ids.length ? await Promise.all([
    executor.select({ matchId: matchMaps.matchId, mapName: matchMaps.mapName, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB })
      .from(matchMaps).where(inArray(matchMaps.matchId, ids)),
    executor.select({ matchId: matchVetoSteps.matchId, entryId: matchVetoSteps.entryId, mapName: matchVetoSteps.mapName, actionType: matchVetoSteps.actionType })
      .from(matchVetoSteps).where(and(inArray(matchVetoSteps.matchId, ids), inArray(matchVetoSteps.actionType, ["pick", "ban"]))),
  ]) : [[], []];
  return scopes.map(scope => {
    const matchIds = new Set(scope.matches.map(match => match.id));
    return {
      mapWins: projectMapWinStats(scope.entryId, scope.matches, maps),
      picks: projectVetoStats(scope.entryId, matchIds, steps.filter(step => step.actionType === "pick")),
      bans: projectVetoStats(scope.entryId, matchIds, steps.filter(step => step.actionType === "ban")),
    };
  });
}
