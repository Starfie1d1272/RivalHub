import { eq, and, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, swissStandings, teams } from "@/db/schema";
import type { SwissStanding, SwissStatus } from "@/db/schema/swiss-standings";

export interface SwissTeamSlot {
  teamId: string;
  teamName: string;
  seed: number;
  wins: number;
  losses: number;
  status: SwissStatus;
  buScore: number;
}

export interface SwissMatchRow {
  matchId: string;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  scoreA: number | null;
  scoreB: number | null;
  status: string; // scheduled | in_progress | finished | cancelled
  format: string;
  round: number;
}

export interface SwissRecordGroup {
  record: string; // "0:0", "1:0", "0:1", etc.
  matchups: SwissMatchRow[];
}

export interface SwissRoundColumn {
  round: number;
  status: "finished" | "active" | "upcoming";
  groups: SwissRecordGroup[];
}

export interface SwissViewData {
  stageName: string;
  teamCount: number;
  advanceCount: number;
  rounds: SwissRoundColumn[];
  teams: SwissTeamSlot[];
}

export async function getSwissViewData(
  seasonId: string,
  stageKey: string,
  stageName: string,
): Promise<SwissViewData> {
  // 三次查询包进事务，保证快照一致性（防止 advanceRound 并发写导致视图撕裂）
  const [standings, allMatches, teamRows] = await db.transaction(async (tx) => {
    return Promise.all([
      tx.query.swissStandings.findMany({
        where: and(
          eq(swissStandings.seasonId, seasonId),
          eq(swissStandings.stage, stageKey),
        ),
        orderBy: [asc(swissStandings.seed)],
      }),
      tx.query.matches.findMany({
        where: and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, stageKey),
        ),
        orderBy: [asc(matches.round), asc(matches.createdAt)],
      }),
      tx.query.teams.findMany({
        where: eq(teams.seasonId, seasonId),
      }),
    ]);
  });
  const teamNameMap = new Map(teamRows.map((t) => [t.id, t.name]));

  // 4. 构建团队列表
  const teamSlots: SwissTeamSlot[] = standings.map((s) => ({
    teamId: s.teamId,
    teamName: teamNameMap.get(s.teamId) ?? "未知队伍",
    seed: s.seed,
    wins: s.wins,
    losses: s.losses,
    status: s.status as SwissStatus,
    buScore: s.buScore,
  }));

  const advanceCount = standings.filter((s) => s.status === "advanced").length;

  // 5. 当前最大轮次
  const maxRound = allMatches.length > 0
    ? Math.max(...allMatches.map((m) => m.round ?? 0))
    : 0;

  const currentRound = maxRound > 0
    ? (allMatches.some(
        (m) =>
          m.round === maxRound &&
          m.status !== "finished" &&
          m.status !== "cancelled",
      )
        ? maxRound // still has active matches
        : maxRound + 1) // all matches in max round finished → next round upcoming
    : 1;

  // 6. 按轮次分组
  const matchesByRound = new Map<number, SwissMatchRow[]>();
  for (const m of allMatches) {
    const r = m.round ?? 1;
    const list = matchesByRound.get(r) ?? [];
    list.push({
      matchId: m.id,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      teamAName: teamNameMap.get(m.teamAId) ?? "TBD",
      teamBName: teamNameMap.get(m.teamBId) ?? "TBD",
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      status: m.status,
      format: m.format,
      round: r,
    });
    matchesByRound.set(r, list);
  }

  // 7. 建列
  const maxPossibleRounds = Math.min(5, Math.ceil(Math.log2(standings.length)) + 3);
  const totalRounds = Math.max(maxRound + 1, maxPossibleRounds);

  const rounds: SwissRoundColumn[] = [];
  for (let r = 1; r <= totalRounds; r++) {
    const roundMatches = matchesByRound.get(r) ?? [];
    const status: SwissRoundColumn["status"] =
      r < currentRound
        ? "finished"
        : r === currentRound && roundMatches.length > 0
          ? "active"
          : "upcoming";

    // 按 record 分组
    const groups = groupMatchesByRecord(roundMatches, standings, r === 1);
    rounds.push({ round: r, status, groups });
  }

  return {
    stageName,
    teamCount: standings.length,
    advanceCount,
    rounds,
    teams: teamSlots,
  };
}

function groupMatchesByRecord(
  matchRows: SwissMatchRow[],
  standings: SwissStanding[],
  _isFirstRound: boolean,
): SwissRecordGroup[] {
  const teamRecord = new Map<string, string>();
  for (const s of standings) {
    teamRecord.set(s.teamId, `${s.wins}:${s.losses}`);
  }

  // 按 record 分组
  const groupMap = new Map<string, SwissMatchRow[]>();
  for (const m of matchRows) {
    // 用 teamA 的 record 作为组标识
    const recordA = teamRecord.get(m.teamAId) ?? "0:0";
    const recordB = teamRecord.get(m.teamBId) ?? "0:0";
    // 组的 key 用两个队伍共同的 record（同一组配对）
    const key = recordA === recordB ? recordA : `${recordA} | ${recordB}`;
    const list = groupMap.get(key) ?? [];
    list.push(m);
    groupMap.set(key, list);
  }

  // 去重（同一个 match 可能被重复分组）
  const seen = new Set<string>();
  const grouped = new Map<string, SwissMatchRow[]>();
  for (const [key, rows] of groupMap) {
    const deduped = rows.filter((r) => {
      if (seen.has(r.matchId)) return false;
      seen.add(r.matchId);
      return true;
    });
    if (deduped.length > 0) grouped.set(key, deduped);
  }

  // 排序：按 record 优先级
  const recordOrder = [
    "0:0", "1:0", "0:1", "2:0", "1:1", "0:2",
    "3:0", "2:1", "1:2", "0:3", "2:2", "3:1", "1:3", "3:2", "2:3",
  ];

  return Array.from(grouped.entries())
    .sort(([a], [b]) => {
      const ai = recordOrder.indexOf(a);
      const bi = recordOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([record, matchups]) => ({
      record,
      matchups,
    }));
}
