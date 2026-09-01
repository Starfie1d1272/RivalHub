import type { CompetitiveProfileConfig } from "@/types/season";

export interface PlayerStrengthFact {
  rank: string;
  rating: number;
}

export interface PlayerStrengthInput {
  userId: string;
  label: string;
  historicalPeak: PlayerStrengthFact | null;
  previousSeasonPeak: PlayerStrengthFact | null;
  currentSeasonPeak: PlayerStrengthFact | null;
  /** Facts for an event policy's recent reference set; null entries are valid. */
  recentSeasonPeaks?: Array<PlayerStrengthFact | null>;
}

export interface PlayerStrengthBreakdown {
  available: boolean;
  blockers: string[];
  weightedRank: number | null;
  historicalValue: number | null;
  previousValue: number | null;
  currentValue: number | null;
  historicalRating: number | null;
}

function rankValue(rank: string, config: CompetitiveProfileConfig): number | null {
  const index = config.rankOrder.findIndex((item) => item === rank);
  return index < 0 ? null : index + 1;
}

function effectiveRecentPeak(player: PlayerStrengthInput, config: CompetitiveProfileConfig): PlayerStrengthFact | null {
  if (!config.evidencePolicy) return player.currentSeasonPeak;
  const candidates = player.recentSeasonPeaks ?? [];
  let strongest: PlayerStrengthFact | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = rankValue(candidate.rank, config);
    if (value === null) return candidate;
    if (!strongest || value > (rankValue(strongest.rank, config) ?? Number.NEGATIVE_INFINITY)) strongest = candidate;
  }
  return strongest;
}

/** Rule-file order: weighted rank, historical, current, previous, historical Rating. */
export function getPlayerStrengthBreakdown(player: PlayerStrengthInput, config: CompetitiveProfileConfig): PlayerStrengthBreakdown {
  const blockers: string[] = [];
  if (!config.platform || !config.currentSeasonKey || !config.previousSeasonKey || config.rankOrder.length === 0) {
    blockers.push("赛事尚未配置完美平台当前/上赛季或段位映射。");
  }
  if (!player.historicalPeak) blockers.push("缺少历史最高段位及 Rating。");
  if (!player.previousSeasonPeak) blockers.push(config.evidencePolicy ? "缺少前一完整赛季最高段位及 Rating。" : "缺少上赛季最高段位及 Rating。");
  const recentPeak = effectiveRecentPeak(player, config);
  if (!recentPeak) blockers.push(config.evidencePolicy ? "缺少近期赛季最高段位及 Rating。" : "缺少当前赛季最高段位及 Rating。");
  if (blockers.length > 0) return { available: false, blockers, weightedRank: null, historicalValue: null, previousValue: null, currentValue: null, historicalRating: null };
  const historicalValue = rankValue(player.historicalPeak!.rank, config);
  const previousValue = rankValue(player.previousSeasonPeak!.rank, config);
  const currentValue = rankValue(recentPeak!.rank, config);
  if (historicalValue === null || previousValue === null || currentValue === null) {
    return { available: false, blockers: ["申报段位不在本赛事公布的段位映射中。"], weightedRank: null, historicalValue, previousValue, currentValue, historicalRating: player.historicalPeak!.rating };
  }
  return { available: true, blockers: [], weightedRank: historicalValue * 0.5 + previousValue * 0.2 + currentValue * 0.3, historicalValue, previousValue, currentValue, historicalRating: player.historicalPeak!.rating };
}

export interface PlayerStrengthComparison {
  order: -1 | 0 | 1;
  reason: string;
  left: PlayerStrengthBreakdown;
  right: PlayerStrengthBreakdown;
}

/** Returns positive when left is stronger. Missing required facts are never ranked. */
export function comparePlayerStrength(left: PlayerStrengthInput, right: PlayerStrengthInput, config: CompetitiveProfileConfig): PlayerStrengthComparison {
  const leftBreakdown = getPlayerStrengthBreakdown(left, config);
  const rightBreakdown = getPlayerStrengthBreakdown(right, config);
  if (!leftBreakdown.available || !rightBreakdown.available) return { order: 0, reason: "至少一名选手的规则要求竞技资料不可确认，不能自动比较。", left: leftBreakdown, right: rightBreakdown };
  const comparisons: Array<[number, string]> = [
    [
      (leftBreakdown.historicalValue! * 5 + leftBreakdown.previousValue! * 2 + leftBreakdown.currentValue! * 3) -
        (rightBreakdown.historicalValue! * 5 + rightBreakdown.previousValue! * 2 + rightBreakdown.currentValue! * 3),
      config.evidencePolicy ? "综合段位参考值（历史 50%、前一完整赛季 20%、近期最高 30%）" : "综合段位参考值（历史 50%、上赛季 20%、当前赛季 30%）",
    ],
    [leftBreakdown.historicalValue! - rightBreakdown.historicalValue!, "历史最高段位"],
    [leftBreakdown.currentValue! - rightBreakdown.currentValue!, config.evidencePolicy ? "近期赛季最高段位" : "当前赛季最高段位"],
    [leftBreakdown.previousValue! - rightBreakdown.previousValue!, config.evidencePolicy ? "前一完整赛季最高段位" : "上赛季最高段位"],
    [leftBreakdown.historicalRating! - rightBreakdown.historicalRating!, "历史最高段位对应 Rating"],
  ];
  const found = comparisons.find(([value]) => value !== 0);
  return { order: found ? (found[0] > 0 ? 1 : -1) : 0, reason: found ? `按${found[1]}区分。` : "所有规则指定的比较项均相同，视为实力相当。", left: leftBreakdown, right: rightBreakdown };
}

export function evaluateExternalStrengthRule(input: { players: Array<PlayerStrengthInput & { isHome: boolean }>; config: CompetitiveProfileConfig }): { eligible: boolean; blockers: string[] } {
  const home = input.players.filter((player) => player.isHome);
  const external = input.players.filter((player) => !player.isHome);
  if (home.length === 0) return { eligible: false, blockers: ["阵容中没有可确认的南京大学成员，无法执行外校成员实力限制。"] };
  const strongestHome = home.reduce((strongest, player) => comparePlayerStrength(player, strongest, input.config).order > 0 ? player : strongest);
  const blockers: string[] = [];
  for (const player of external) {
    const comparison = comparePlayerStrength(player, strongestHome, input.config);
    if (!comparison.left.available || !comparison.right.available) blockers.push(`${player.label} 与南京大学成员 ${strongestHome.label} 的实力资料不可确认：${comparison.reason}`);
    else if (comparison.order > 0) blockers.push(`外校选手 ${player.label} 的实力高于阵容中最强南京大学成员 ${strongestHome.label}：${comparison.reason}`);
  }
  return { eligible: blockers.length === 0, blockers };
}
