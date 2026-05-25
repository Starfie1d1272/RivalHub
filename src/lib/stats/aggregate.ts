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

/**
 * 跨赛季聚合（AggregatedPlayerStats[] → 单一汇总）
 * 使用 totalRounds 作为 ADR/Rating/RWS/WE 的加权权重。
 * HS% 用 maps 加权（raw kills 已聚合丢失）。
 */
export function aggregateAcrossSeasons(
  seasons: Array<
    Pick<
      AggregatedPlayerStats,
      | "maps"
      | "totalRounds"
      | "kills"
      | "deaths"
      | "assists"
      | "firstKills"
      | "multiKills"
      | "clutches"
      | "adr"
      | "hsPercent"
      | "ratingPro"
      | "rws"
      | "we"
    >
  >,
): Omit<AggregatedPlayerStats, "userId" | "perfectName"> {
  const totalRounds = seasons.reduce((s, x) => s + x.totalRounds, 0);
  const totalMaps = seasons.reduce((s, x) => s + x.maps, 0);
  const totalKills = seasons.reduce((s, x) => s + x.kills, 0);
  const totalDeaths = seasons.reduce((s, x) => s + x.deaths, 0);
  const totalFirstKills = seasons.reduce((s, x) => s + x.firstKills, 0);
  const totalMultiKills = seasons.reduce((s, x) => s + x.multiKills, 0);
  const totalClutches = seasons.reduce((s, x) => s + x.clutches, 0);

  const rw = (field: keyof (typeof seasons)[0]) =>
    totalRounds > 0
      ? seasons.reduce((s, x) => s + (Number(x[field]) || 0) * x.totalRounds, 0) / totalRounds
      : null;

  return {
    maps: totalMaps,
    totalRounds,
    kills: totalKills,
    deaths: totalDeaths,
    assists: seasons.reduce((s, x) => s + x.assists, 0),
    firstKills: totalFirstKills,
    multiKills: totalMultiKills,
    clutches: totalClutches,
    kd: totalDeaths > 0 ? totalKills / totalDeaths : null,
    kpr: totalRounds > 0 ? totalKills / totalRounds : null,
    fkpr: totalRounds > 0 ? totalFirstKills / totalRounds : null,
    mkpr: totalRounds > 0 ? totalMultiKills / totalRounds : null,
    cpr: totalRounds > 0 ? totalClutches / totalRounds : null,
    adr: rw("adr"),
    hsPercent:
      totalMaps > 0
        ? seasons.reduce((s, x) => s + (x.hsPercent ?? 0) * x.maps, 0) / totalMaps
        : null,
    ratingPro: rw("ratingPro"),
    rws: rw("rws"),
    we: rw("we"),
  };
}
