import { sumNums, avgNums, weightedAvgNums } from "@/lib/utils/stats";
import type { AggregatedPlayerStats } from "./types";

/** match_player_stats 行 + rounds（必须由调用方传入，来自 matchMaps.scoreA+scoreB） */
export interface StatRowInput {
  userId: string | null;
  perfectName: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  hsPercent: number | null;
  firstKills: number | null;
  multiKills: number | null;
  clutches: number | null;
  adr: number | null;
  rws: number | null;
  ratingPro: number | null;
  we: number | null;
  /** 该图回合总数（matchMaps.scoreA + matchMaps.scoreB） */
  rounds: number;
}

/**
 * 规范化 in-memory 多图聚合（同一选手的多行 → 单一 AggregatedPlayerStats）：
 * - ADR：回合加权
 * - HS%：击杀数加权
 * - Rating/RWS/WE：简单图均
 * - KD/KPR/FKPR/MKPR/CPR：累计比 / 累计 per-round
 */
export function aggregatePlayerRows(rows: StatRowInput[]): AggregatedPlayerStats {
  if (rows.length === 0) throw new Error("aggregatePlayerRows: empty rows");

  const totalRounds = rows.reduce((s, r) => s + r.rounds, 0);
  const totalKills = sumNums(rows.map((r) => r.kills)) ?? 0;
  const totalDeaths = sumNums(rows.map((r) => r.deaths)) ?? 0;
  const totalFirstKills = sumNums(rows.map((r) => r.firstKills)) ?? 0;
  const totalMultiKills = sumNums(rows.map((r) => r.multiKills)) ?? 0;
  const totalClutches = sumNums(rows.map((r) => r.clutches)) ?? 0;

  return {
    userId: rows[0].userId,
    perfectName: rows[0].perfectName,
    maps: rows.length,
    totalRounds,
    kills: totalKills,
    deaths: totalDeaths,
    assists: sumNums(rows.map((r) => r.assists)) ?? 0,
    firstKills: totalFirstKills,
    multiKills: totalMultiKills,
    clutches: totalClutches,
    kd: totalDeaths > 0 ? totalKills / totalDeaths : null,
    kpr: totalRounds > 0 ? totalKills / totalRounds : null,
    fkpr: totalRounds > 0 ? totalFirstKills / totalRounds : null,
    mkpr: totalRounds > 0 ? totalMultiKills / totalRounds : null,
    cpr: totalRounds > 0 ? totalClutches / totalRounds : null,
    adr:
      totalRounds > 0
        ? rows.reduce((s, r) => s + (r.adr ?? 0) * r.rounds, 0) / totalRounds
        : null,
    hsPercent: weightedAvgNums(
      rows.map((r) => r.hsPercent),
      rows.map((r) => r.kills),
    ),
    ratingPro: avgNums(rows.map((r) => r.ratingPro)),
    rws: avgNums(rows.map((r) => r.rws)),
    we: avgNums(rows.map((r) => r.we)),
  };
}
