import type { CompetitiveProfileConfig } from "@/types/season";
import { PERFECT_WORLD_STAR_RANKS } from "@/lib/config/perfect-world";

export interface PlayerStrengthFact {
  rank: string;
  rating: number;
  /** Only same-platform Ratings are comparable in the final strength tie-break. */
  ratingComparable?: boolean;
  /** Frozen origin for an equivalence-derived fact; omitted for legacy snapshots. */
  sourcePlatform?: string;
  sourceSeasonKey?: string | null;
  sourceRank?: string;
  conversionVersion?: string;
  /** Total stars on a star-based (S) rank; null for starless ranks or legacy facts. */
  stars?: number | null;
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

function evidenceWeights(config: CompetitiveProfileConfig) {
  return config.evidencePolicy
    ? config.evidencePolicy
    : { historicalWeight: 50, referenceSeasonWeight: 20, recentSeasonWeight: 30 };
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
  const weights = evidenceWeights(config);
  return { available: true, blockers: [], weightedRank: (historicalValue * weights.historicalWeight + previousValue * weights.referenceSeasonWeight + currentValue * weights.recentSeasonWeight) / 100, historicalValue, previousValue, currentValue, historicalRating: player.historicalPeak!.ratingComparable === false ? null : player.historicalPeak!.rating };
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
      (() => {
        const weights = evidenceWeights(config);
        return (leftBreakdown.historicalValue! * weights.historicalWeight + leftBreakdown.previousValue! * weights.referenceSeasonWeight + leftBreakdown.currentValue! * weights.recentSeasonWeight) -
          (rightBreakdown.historicalValue! * weights.historicalWeight + rightBreakdown.previousValue! * weights.referenceSeasonWeight + rightBreakdown.currentValue! * weights.recentSeasonWeight);
      })(),
      config.evidencePolicy ? "综合段位参考值（历史 50%、前一完整赛季 20%、近期最高 30%）" : "综合段位参考值（历史 50%、上赛季 20%、当前赛季 30%）",
    ],
    [leftBreakdown.historicalValue! - rightBreakdown.historicalValue!, "历史最高段位"],
    [leftBreakdown.currentValue! - rightBreakdown.currentValue!, config.evidencePolicy ? "近期赛季最高段位" : "当前赛季最高段位"],
    [leftBreakdown.previousValue! - rightBreakdown.previousValue!, config.evidencePolicy ? "前一完整赛季最高段位" : "上赛季最高段位"],
    ...(leftBreakdown.historicalRating !== null && rightBreakdown.historicalRating !== null
      ? [[leftBreakdown.historicalRating - rightBreakdown.historicalRating, "历史最高段位对应 Rating"] as [number, string]]
      : []),
  ];
  const found = comparisons.find(([value]) => value !== 0);
  return { order: found ? (found[0] > 0 ? 1 : -1) : 0, reason: found ? `按${found[1]}区分。` : "所有规则指定的比较项均相同，视为实力相当。", left: leftBreakdown, right: rightBreakdown };
}

/** 外校队员相对本校最强队员的历史最高总星数最大允许差值（默认 3 星）。 */
const DEFAULT_EXTERNAL_STRENGTH_MAX_STAR_GAP = 3;

const PERFECT_WORLD_STAR_RANK_SET = new Set<string>(PERFECT_WORLD_STAR_RANKS);

type HistoricalPeakStarPosition =
  | { kind: "missing" }
  | { kind: "starless" }
  | { kind: "insufficient" }
  | { kind: "stars"; stars: number };

/** 历史最高竞技水平按总星数归类，作为外校相对限制的唯一比较口径。 */
function historicalPeakStarPosition(player: PlayerStrengthInput): HistoricalPeakStarPosition {
  const fact = player.historicalPeak;
  if (!fact || !fact.rank) return { kind: "missing" };
  if (!PERFECT_WORLD_STAR_RANK_SET.has(fact.rank)) return { kind: "starless" };
  if (fact.stars === null || fact.stars === undefined) return { kind: "insufficient" };
  return { kind: "stars", stars: fact.stars };
}

/**
 * 队内最强外校选手的完美世界历史最高总星数不得高于队内最强本校选手超过
 * `externalStrengthMaxStarGap`（默认 3）星。缺星数或缺少历史最高视为“自动
 * 判断不足”，返回不可自动通过，交由赛委会人工审核。
 */
export function evaluateExternalStrengthRule(input: { players: Array<PlayerStrengthInput & { isHome: boolean }>; config: CompetitiveProfileConfig }): { eligible: boolean; blockers: string[] } {
  const home = input.players.filter((player) => player.isHome);
  const external = input.players.filter((player) => !player.isHome);
  if (home.length === 0) return { eligible: false, blockers: ["阵容中没有可确认的南京大学成员，无法执行外校成员实力限制。"] };
  if (external.length === 0) return { eligible: true, blockers: [] };

  const maxGap = input.config.externalStrengthMaxStarGap ?? DEFAULT_EXTERNAL_STRENGTH_MAX_STAR_GAP;
  const blockers: string[] = [];

  const resolve = (player: PlayerStrengthInput & { isHome: boolean }): number | null => {
    const position = historicalPeakStarPosition(player);
    if (position.kind === "stars") return position.stars;
    if (position.kind === "starless") return Number.NEGATIVE_INFINITY;
    if (position.kind === "insufficient") {
      blockers.push(`选手 ${player.label} 的历史最高属于 S 段位但缺少准确星数，无法自动判断外校相对实力限制，需赛委会人工审核。`);
    } else {
      blockers.push(`选手 ${player.label} 缺少历史最高段位，无法自动判断外校相对实力限制。`);
    }
    return null;
  };

  const homeStars: number[] = [];
  const externalStars: number[] = [];
  for (const player of home) {
    const value = resolve(player);
    if (value !== null) homeStars.push(value);
  }
  for (const player of external) {
    const value = resolve(player);
    if (value !== null) externalStars.push(value);
  }
  if (blockers.length > 0) return { eligible: false, blockers: [...new Set(blockers)] };

  const strongestHome = homeStars.length > 0 ? Math.max(...homeStars) : Number.NEGATIVE_INFINITY;
  const strongestExternal = externalStars.length > 0 ? Math.max(...externalStars) : Number.NEGATIVE_INFINITY;

  // 外校无可比星数（无 S 段位成员）时不会超过本校基线。
  if (strongestExternal === Number.NEGATIVE_INFINITY) return { eligible: true, blockers: [] };
  if (strongestHome === Number.NEGATIVE_INFINITY) {
    const externalLabel = external[externalStars.indexOf(strongestExternal)].label;
    return { eligible: false, blockers: [`外校选手 ${externalLabel} 的历史最高属于 S 段位，而本校成员均无 S 段位星数，超出外校相对实力限制。`] };
  }
  if (strongestExternal - strongestHome > maxGap) {
    const externalLabel = external[externalStars.indexOf(strongestExternal)].label;
    const homeLabel = home[homeStars.indexOf(strongestHome)].label;
    return { eligible: false, blockers: [`外校选手 ${externalLabel} 的历史最高（${strongestExternal} 星）高于本校最强 ${homeLabel}（${strongestHome} 星）超过 ${maxGap} 星，超出外校相对实力限制。`] };
  }
  return { eligible: true, blockers: [] };
}
