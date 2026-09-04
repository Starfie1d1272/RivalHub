import { avgNums, sumNums, weightedAvgNums } from "@/lib/utils/stats";
import type { AggregatedPlayerStats } from "./types";

/** match_player_stats 行 + rounds（来自 matchMaps.scoreA + scoreB）。 */
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
  /** 该图回合总数；无法从比赛事实得到时为 null。 */
  rounds: number | null;
}

type CountMetric = "kills" | "deaths" | "assists" | "firstKills" | "multiKills" | "clutches";
type CompleteSumMetric = CountMetric | "rounds";

function completeSum(rows: StatRowInput[], metric: CompleteSumMetric): number | null {
  const values = rows.map((row) => row[metric]);
  if (values.some((value) => value == null)) return null;
  return sumNums(values as number[]);
}

/** 只使用对应 count 与 rounds 都已知的行。 */
function perRoundKnown(rows: StatRowInput[], metric: CountMetric): number | null {
  let numerator = 0;
  let denominator = 0;
  let hasKnownValue = false;

  for (const row of rows) {
    const value = row[metric];
    if (value == null || row.rounds == null) continue;
    hasKnownValue = true;
    numerator += value;
    denominator += row.rounds;
  }

  return hasKnownValue && denominator > 0 ? numerator / denominator : null;
}

/**
 * 规范化 in-memory 多图聚合（同一选手的多行 → 单一 AggregatedPlayerStats）：
 * - ADR：只对 ADR 与 rounds 都已知的图回合加权
 * - HS%：只对 HS% 与 kills 都已知的图按击杀数加权
 * - Rating/RWS/WE：已知图简单均值
 * - count：纳入范围任一行缺失即返回 null；真实全量 0 保留为 0
 * - KD：使用 complete raw kills / deaths
 * - KPR/FKPR/MKPR/CPR：只用对应 count 与 rounds 都已知的行
 */
export function aggregatePlayerRows(rows: StatRowInput[]): AggregatedPlayerStats {
  if (rows.length === 0) throw new Error("aggregatePlayerRows: empty rows");

  const totalRounds = completeSum(rows, "rounds");
  const totalKills = completeSum(rows, "kills");
  const totalDeaths = completeSum(rows, "deaths");

  return {
    userId: rows[0].userId,
    perfectName: rows[0].perfectName,
    maps: rows.length,
    totalRounds,
    kills: totalKills,
    deaths: totalDeaths,
    assists: completeSum(rows, "assists"),
    firstKills: completeSum(rows, "firstKills"),
    multiKills: completeSum(rows, "multiKills"),
    clutches: completeSum(rows, "clutches"),
    kd: totalKills != null && totalDeaths != null && totalDeaths > 0 ? totalKills / totalDeaths : null,
    kpr: perRoundKnown(rows, "kills"),
    fkpr: perRoundKnown(rows, "firstKills"),
    mkpr: perRoundKnown(rows, "multiKills"),
    cpr: perRoundKnown(rows, "clutches"),
    adr: weightedAvgNums(rows.map((row) => row.adr), rows.map((row) => row.rounds)),
    hsPercent: weightedAvgNums(rows.map((row) => row.hsPercent), rows.map((row) => row.kills)),
    ratingPro: avgNums(rows.map((row) => row.ratingPro)),
    rws: avgNums(rows.map((row) => row.rws)),
    we: avgNums(rows.map((row) => row.we)),
  };
}
