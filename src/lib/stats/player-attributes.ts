import type { TournamentPerformancePlayerSummary } from "@cs2dak/tournament";
import {
  buildMetricBenchmark,
  projectMetricBenchmarkScore,
  type MetricBenchmark,
  type MetricBenchmarkProjection,
} from "./benchmark";
import { getDynamicRankingFloor, isRankingEligible } from "./ranking";
import type { StatsMetricKey } from "./metrics";

export type PlayerAttributeKey =
  | "firepower"
  | "entrying"
  | "trading"
  | "opening"
  | "clutching"
  | "sniping"
  | "utility";

export type PlayerAttributeMetricKey =
  | "kpr"
  | "adr"
  | "multiKillRoundRate"
  | "killRoundRate"
  | "threePlusKillRoundRate"
  | "tradedDeathRate"
  | "openingDeathTradedRate"
  | "traded"
  | "firstDeath"
  | "assist"
  | "trade"
  | "tradeKillShare"
  | "damagePerKill"
  | "openingAttempt"
  | "firstKill"
  | "openingWin"
  | "winAfterOpeningWin"
  | "winAfterOpeningLoss"
  | "clutchAttemptRate"
  | "clutch"
  | "clutchFrequency"
  | "clutch1v1"
  | "clutch1v2"
  | "clutch1v3"
  | "sniperKillShare"
  | "sniperKillsPerRound"
  | "awpKillShare"
  | "awpKillsPerRound"
  | "grenadeUsage"
  | "utility"
  | "flashAssist"
  | "blindPerFlash"
  | "hePerThrow"
  | "firePerThrow";

export interface PlayerAttributeMetricProjection {
  key: PlayerAttributeMetricKey;
  metric: StatsMetricKey;
  value: number | null;
  sample: number | null;
  score: number | null;
  status: "qualified" | "limited" | "no-data";
  floor: number | null;
  weight: number | null;
}

export interface PlayerAttributeProjection {
  key: PlayerAttributeKey;
  label: string;
  description: string;
  formula: string;
  score: number | null;
  status: "qualified" | "limited" | "no-data";
  rank: number | null;
  rankedCount: number;
  metrics: PlayerAttributeMetricProjection[];
}

export interface PlayerAttributeProfile {
  benchmarkLabel: string;
  attributes: PlayerAttributeProjection[];
}

interface MetricObservation {
  value: number | null;
  sample: number | null;
}

type MetricBenchmarks = Record<PlayerAttributeMetricKey, MetricBenchmark | null>;

interface AttributeMetricDefinition {
  key: PlayerAttributeMetricKey;
  metric: StatsMetricKey;
}

interface AttributeScoreInput extends AttributeMetricDefinition {
  weight: number;
}

interface AttributeDefinition {
  key: PlayerAttributeKey;
  label: string;
  description: string;
  formula: string;
  scoreInputs: readonly AttributeScoreInput[];
  details: readonly AttributeMetricDefinition[];
}

export const PLAYER_ATTRIBUTE_DEFINITIONS: readonly AttributeDefinition[] = [
  {
    key: "firepower",
    label: "Firepower",
    description: "衡量选手直接制造击杀、伤害与多杀爆发的能力，是七项属性中最偏向实际输出表现的一项。",
    formula: "KPR 45% + ADR 40% + 2K+ Round% 15%。各输入先按 RivalHub 全站历史合格样本换算为 0–100 相对分，再按权重合成。",
    scoreInputs: [
      { key: "kpr", metric: "kpr", weight: 0.45 },
      { key: "adr", metric: "adr", weight: 0.40 },
      { key: "multiKillRoundRate", metric: "multiKillRoundRate", weight: 0.15 },
    ],
    details: [
      { key: "kpr", metric: "kpr" },
      { key: "killRoundRate", metric: "killRoundRate" },
      { key: "adr", metric: "adr" },
      { key: "multiKillRoundRate", metric: "multiKillRoundRate" },
      { key: "threePlusKillRoundRate", metric: "threePlusKillRoundRate" },
    ],
  },
  {
    key: "entrying",
    label: "Entrying",
    description: "衡量选手承担第一身位风险、并让自己的死亡处于可补枪结构中的程度。它更接近打法特征，不应简单理解成高分就一定更强。",
    formula: "Traded Deaths/100r 60% + Opening Deaths Traded% 40%。两项分别描述整体可交易死亡频率，以及首死后被队友及时补枪的比例。",
    scoreInputs: [
      { key: "tradedDeathRate", metric: "tradedDeathRate", weight: 0.60 },
      { key: "openingDeathTradedRate", metric: "openingDeathTradedRate", weight: 0.40 },
    ],
    details: [
      { key: "tradedDeathRate", metric: "tradedDeathRate" },
      { key: "traded", metric: "traded" },
      { key: "openingDeathTradedRate", metric: "openingDeathTradedRate" },
      { key: "firstDeath", metric: "firstDeath" },
      { key: "assist", metric: "assist" },
    ],
  },
  {
    key: "trading",
    label: "Trading",
    description: "衡量选手作为后续枪位完成补枪的频率，以及补枪击杀在个人击杀结构中的占比。",
    formula: "Trade/100r 60% + Trade Kill Share 40%。前者看补枪产量，后者看个人击杀中有多少来自补枪场景。",
    scoreInputs: [
      { key: "trade", metric: "trade", weight: 0.60 },
      { key: "tradeKillShare", metric: "tradeKillShare", weight: 0.40 },
    ],
    details: [
      { key: "trade", metric: "trade" },
      { key: "tradeKillShare", metric: "tradeKillShare" },
      { key: "assist", metric: "assist" },
      { key: "damagePerKill", metric: "damagePerKill" },
    ],
  },
  {
    key: "opening",
    label: "Opening",
    description: "衡量选手主动参与回合首次交火的程度。高分表示更频繁参与首杀对枪，并不等同于首杀胜率更高。",
    formula: "Attempts% 65% + FK/100r 35%。参与度是主信号，首杀产出用于补充实际结果；Success% 等效率指标只作为详情展示。",
    scoreInputs: [
      { key: "openingAttempt", metric: "openingAttempt", weight: 0.65 },
      { key: "firstKill", metric: "firstKill", weight: 0.35 },
    ],
    details: [
      { key: "openingAttempt", metric: "openingAttempt" },
      { key: "firstKill", metric: "firstKill" },
      { key: "firstDeath", metric: "firstDeath" },
      { key: "openingWin", metric: "openingWin" },
      { key: "winAfterOpeningWin", metric: "winAfterOpeningWin" },
      { key: "winAfterOpeningLoss", metric: "winAfterOpeningLoss" },
    ],
  },
  {
    key: "clutching",
    label: "Clutching",
    description: "衡量选手进入 1vX 残局的频率和实际赢下残局的效率，同时保留不同人数残局作为解释信息。",
    formula: "Clutch Attempts/100r 40% + Clutch% 60%。进入残局的频率描述角色处境，残局胜率承担更高权重。",
    scoreInputs: [
      { key: "clutchAttemptRate", metric: "clutchAttemptRate", weight: 0.40 },
      { key: "clutch", metric: "clutch", weight: 0.60 },
    ],
    details: [
      { key: "clutchAttemptRate", metric: "clutchAttemptRate" },
      { key: "clutch", metric: "clutch" },
      { key: "clutchFrequency", metric: "clutchFrequency" },
      { key: "clutch1v1", metric: "clutchSplit" },
      { key: "clutch1v2", metric: "clutchSplit" },
      { key: "clutch1v3", metric: "clutchSplit" },
    ],
  },
  {
    key: "sniping",
    label: "Sniping",
    description: "衡量 AWP / SSG 08 在个人击杀结构中的占比，主要反映狙击角色使用强度，而不是单独评价狙击枪法。完全没有狙击击杀时记为 0 分。",
    formula: "Sniper Kill Share 100%。0 使用直接记 0；有狙击击杀的样本在正使用人群中进行相对比较。",
    scoreInputs: [
      { key: "sniperKillShare", metric: "sniperKillShare", weight: 1 },
    ],
    details: [
      { key: "sniperKillShare", metric: "sniperKillShare" },
      { key: "sniperKillsPerRound", metric: "sniperKillsPerRound" },
      { key: "awpKillShare", metric: "awpKillShare" },
      { key: "awpKillsPerRound", metric: "awpKillsPerRound" },
    ],
  },
  {
    key: "utility",
    label: "Utility",
    description: "衡量道具使用量、伤害贡献和闪光助攻贡献。三部分相关性并不高，因此共同用于描述更完整的道具参与。",
    formula: "Nades/r 30% + Util/r 35% + FA/100r 35%。使用量、伤害和闪光助攻分别形成独立的相对分后再合成。",
    scoreInputs: [
      { key: "grenadeUsage", metric: "grenadeUsage", weight: 0.30 },
      { key: "utility", metric: "utility", weight: 0.35 },
      { key: "flashAssist", metric: "flashAssist", weight: 0.35 },
    ],
    details: [
      { key: "grenadeUsage", metric: "grenadeUsage" },
      { key: "utility", metric: "utility" },
      { key: "flashAssist", metric: "flashAssist" },
      { key: "blindPerFlash", metric: "blindPerFlash" },
      { key: "hePerThrow", metric: "hePerThrow" },
      { key: "firePerThrow", metric: "firePerThrow" },
    ],
  },
] as const;

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function weaponKills(player: TournamentPerformancePlayerSummary) {
  return player.weapons.reduce((sum, weapon) => sum + weapon.kills, 0);
}

function weaponKillsByName(player: TournamentPerformancePlayerSummary, names: readonly string[]) {
  const allowed = new Set(names);
  return player.weapons
    .filter((weapon) => allowed.has(weapon.weapon.toLowerCase()))
    .reduce((sum, weapon) => sum + weapon.kills, 0);
}

function sniperKills(player: TournamentPerformancePlayerSummary) {
  return weaponKillsByName(player, ["awp", "ssg08", "scout"]);
}

function awpKills(player: TournamentPerformancePlayerSummary) {
  return weaponKillsByName(player, ["awp"]);
}

function killRounds(player: TournamentPerformancePlayerSummary) {
  const combat = player.slices.overall.combat;
  const value =
    combat.kills
    - combat.twoKillRounds
    - 2 * combat.threeKillRounds
    - 3 * combat.fourKillRounds
    - 4 * combat.fiveKillRounds;
  return Math.max(0, Math.min(player.slices.overall.sample.rounds, value));
}

export function getPlayerAttributeMetricObservation(
  player: TournamentPerformancePlayerSummary,
  key: PlayerAttributeMetricKey,
): MetricObservation {
  const slice = player.slices.overall;
  const rounds = slice.sample.rounds;

  switch (key) {
    case "kpr":
      return { value: slice.combat.killsPerRound.rate, sample: rounds };
    case "adr":
      return { value: slice.combat.damagePerRound.rate, sample: rounds };
    case "multiKillRoundRate": {
      const multiKillRounds =
        slice.combat.twoKillRounds
        + slice.combat.threeKillRounds
        + slice.combat.fourKillRounds
        + slice.combat.fiveKillRounds;
      return { value: ratio(multiKillRounds, rounds), sample: rounds };
    }
    case "killRoundRate":
      return { value: ratio(killRounds(player), rounds), sample: rounds };
    case "threePlusKillRoundRate": {
      const roundsWithThreePlus =
        slice.combat.threeKillRounds
        + slice.combat.fourKillRounds
        + slice.combat.fiveKillRounds;
      return { value: ratio(roundsWithThreePlus, rounds), sample: rounds };
    }
    case "tradedDeathRate":
      return { value: ratio(slice.trade.tradedDeaths, rounds), sample: rounds };
    case "openingDeathTradedRate":
      return {
        value: ratio(slice.trade.tradedOpeningDeaths, slice.opening.firstDeaths),
        sample: slice.opening.firstDeaths,
      };
    case "traded":
      return { value: slice.trade.tradedDeathsPerDeath.rate, sample: slice.trade.deaths };
    case "firstDeath":
      return { value: slice.opening.firstDeathsPerRound.rate, sample: rounds };
    case "assist":
      return { value: slice.combat.assistsPerRound.rate, sample: rounds };
    case "trade":
      return { value: slice.trade.tradeKillsPerRound.rate, sample: rounds };
    case "tradeKillShare":
      return { value: ratio(slice.trade.tradeKills, slice.combat.kills), sample: slice.combat.kills };
    case "damagePerKill":
      return { value: ratio(slice.combat.damage, slice.combat.kills), sample: slice.combat.kills };
    case "openingAttempt":
      return { value: slice.opening.attemptRate.rate, sample: rounds };
    case "firstKill":
      return { value: slice.opening.firstKillsPerRound.rate, sample: rounds };
    case "openingWin":
      return { value: slice.opening.successRate.rate, sample: slice.opening.attempts };
    case "winAfterOpeningWin":
      return {
        value: slice.opening.winRateAfterWinningOpeningDuel.rate,
        sample: slice.opening.firstKills,
      };
    case "winAfterOpeningLoss":
      return {
        value: slice.opening.comebackRateAfterLosingOpeningDuel.rate,
        sample: slice.opening.firstDeaths,
      };
    case "clutchAttemptRate":
      return { value: slice.clutch.frequency.rate, sample: rounds };
    case "clutch":
      return { value: slice.clutch.winRate.rate, sample: slice.clutch.attempts };
    case "clutchFrequency":
      return { value: ratio(slice.clutch.wins, rounds), sample: rounds };
    case "clutch1v1":
      return {
        value: slice.clutch.byOpponentCount["1"].rate,
        sample: slice.clutch.byOpponentCount["1"].attempts,
      };
    case "clutch1v2":
      return {
        value: slice.clutch.byOpponentCount["2"].rate,
        sample: slice.clutch.byOpponentCount["2"].attempts,
      };
    case "clutch1v3":
      return {
        value: slice.clutch.byOpponentCount["3"].rate,
        sample: slice.clutch.byOpponentCount["3"].attempts,
      };
    case "sniperKillShare": {
      const totalKills = weaponKills(player);
      return { value: ratio(sniperKills(player), totalKills), sample: totalKills };
    }
    case "sniperKillsPerRound":
      return { value: ratio(sniperKills(player), rounds), sample: rounds };
    case "awpKillShare": {
      const totalKills = weaponKills(player);
      return { value: ratio(awpKills(player), totalKills), sample: totalKills };
    }
    case "awpKillsPerRound":
      return { value: ratio(awpKills(player), rounds), sample: rounds };
    case "grenadeUsage": {
      const throws =
        slice.utility.flashesThrown
        + slice.utility.heThrows
        + slice.utility.fireThrows
        + slice.utility.smokesThrown;
      return { value: ratio(throws, rounds), sample: rounds };
    }
    case "utility":
      return { value: slice.utility.utilityDamagePerRound.rate, sample: rounds };
    case "flashAssist":
      return { value: slice.utility.flashAssistsPerRound.rate, sample: rounds };
    case "blindPerFlash":
      return { value: slice.utility.enemyBlindSecondsPerFlash.rate, sample: slice.utility.flashesThrown };
    case "hePerThrow":
      return { value: slice.utility.heDamagePerThrow.rate, sample: slice.utility.heThrows };
    case "firePerThrow":
      return { value: slice.utility.fireDamagePerThrow.rate, sample: slice.utility.fireThrows };
  }
}

const SNIPER_METRICS = new Set<PlayerAttributeMetricKey>([
  "sniperKillShare",
  "sniperKillsPerRound",
  "awpKillShare",
  "awpKillsPerRound",
]);

const ALL_METRIC_KEYS = Array.from(new Set(
  PLAYER_ATTRIBUTE_DEFINITIONS.flatMap((attribute) => attribute.details.map((detail) => detail.key)),
)) as PlayerAttributeMetricKey[];

function buildSniperBenchmark(observations: readonly MetricObservation[]): MetricBenchmark | null {
  const valid = observations.filter((row) => row.value != null && Number.isFinite(row.value));
  const floor = getDynamicRankingFloor(valid.map((row) => row.sample));
  if (!floor) return null;

  const qualifiedValues = valid
    .filter((row) => isRankingEligible(row.sample, floor.floor) && (row.value ?? 0) > 0)
    .map((row) => row.value!)
    .sort((left, right) => left - right);

  if (qualifiedValues.length === 0) return null;
  return { floor, qualifiedValues };
}

function buildBenchmarks(population: readonly TournamentPerformancePlayerSummary[]): MetricBenchmarks {
  return Object.fromEntries(ALL_METRIC_KEYS.map((key) => {
    const observations = population.map((player) => getPlayerAttributeMetricObservation(player, key));
    const benchmark = SNIPER_METRICS.has(key)
      ? buildSniperBenchmark(observations)
      : buildMetricBenchmark(observations);
    return [key, benchmark];
  })) as MetricBenchmarks;
}

function projectMetric(
  player: TournamentPerformancePlayerSummary,
  key: PlayerAttributeMetricKey,
  benchmark: MetricBenchmark | null,
): MetricBenchmarkProjection | null {
  if (!benchmark) return null;
  const observation = getPlayerAttributeMetricObservation(player, key);
  if (observation.value == null || !Number.isFinite(observation.value)) return null;

  if (SNIPER_METRICS.has(key) && observation.value === 0) {
    return {
      percentile: 0,
      score: 0,
      status: isRankingEligible(observation.sample, benchmark.floor.floor) ? "qualified" : "limited",
      floor: benchmark.floor.floor,
      qualifiedCount: benchmark.qualifiedValues.length,
    };
  }

  return projectMetricBenchmarkScore(observation, benchmark);
}

function projectAttributes(
  player: TournamentPerformancePlayerSummary,
  benchmarks: MetricBenchmarks,
): PlayerAttributeProjection[] {
  return PLAYER_ATTRIBUTE_DEFINITIONS.map((definition) => {
    const weights = new Map(definition.scoreInputs.map((input) => [input.key, input.weight]));

    const metrics = definition.details.map((detail): PlayerAttributeMetricProjection => {
      const observation = getPlayerAttributeMetricObservation(player, detail.key);
      const projected = projectMetric(player, detail.key, benchmarks[detail.key]);

      return {
        key: detail.key,
        metric: detail.metric,
        value: observation.value,
        sample: observation.sample,
        score: projected?.score ?? null,
        status: projected ? projected.status : "no-data",
        floor: projected?.floor ?? benchmarks[detail.key]?.floor.floor ?? null,
        weight: weights.get(detail.key) ?? null,
      };
    });

    const scoreInputs = definition.scoreInputs
      .map((input) => metrics.find((metric) => metric.key === input.key))
      .filter((metric): metric is PlayerAttributeMetricProjection => metric != null);

    const scored = scoreInputs.filter((metric) => metric.score != null && metric.weight != null);
    if (scored.length === 0) {
      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        formula: definition.formula,
        score: null,
        status: "no-data",
        rank: null,
        rankedCount: 0,
        metrics,
      };
    }

    const availableWeight = scored.reduce((sum, metric) => sum + (metric.weight ?? 0), 0);
    const score = Math.round(
      scored.reduce((sum, metric) => sum + metric.score! * (metric.weight ?? 0), 0) / availableWeight,
    );
    const qualified =
      scoreInputs.length === definition.scoreInputs.length
      && scoreInputs.every((metric) => metric.status === "qualified");

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      formula: definition.formula,
      score,
      status: qualified ? "qualified" : "limited",
      rank: null,
      rankedCount: 0,
      metrics,
    };
  });
}

export function buildPlayerAttributeProfile(
  player: TournamentPerformancePlayerSummary,
  population: readonly TournamentPerformancePlayerSummary[],
): PlayerAttributeProfile {
  const benchmarks = buildBenchmarks(population);
  const target = projectAttributes(player, benchmarks);
  const populationAttributes = population.map((candidate) => projectAttributes(candidate, benchmarks));

  const attributes = target.map((attribute) => {
    const rankedScores = populationAttributes
      .map((candidate) => candidate.find((row) => row.key === attribute.key))
      .filter((row): row is PlayerAttributeProjection => row != null && row.status === "qualified" && row.score != null)
      .map((row) => row.score!)
      .sort((left, right) => right - left);

    const rank = attribute.status === "qualified" && attribute.score != null
      ? 1 + rankedScores.filter((score) => score > attribute.score!).length
      : null;

    return {
      ...attribute,
      rank,
      rankedCount: rankedScores.length,
    };
  });

  return {
    benchmarkLabel: "RivalHub 全站历史基准",
    attributes,
  };
}
