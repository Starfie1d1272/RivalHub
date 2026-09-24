import type { TournamentPerformancePlayerSummary } from "@cs2dak/tournament";
import { buildMetricBenchmark, projectMetricBenchmarkScore, type MetricBenchmark, type MetricBenchmarkProjection } from "./benchmark";
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
  | "tradedDeathRate"
  | "openingDeathTradedRate"
  | "trade"
  | "tradeKillShare"
  | "openingAttempt"
  | "firstKill"
  | "clutchAttemptRate"
  | "clutch"
  | "sniperKillShare"
  | "grenadeUsage"
  | "utility"
  | "flashAssist";

export interface PlayerAttributeMetricProjection {
  key: PlayerAttributeMetricKey;
  metric: StatsMetricKey;
  weight: number;
  value: number | null;
  sample: number | null;
  score: number | null;
  status: "qualified" | "limited" | "no-data";
  floor: number | null;
}

export interface PlayerAttributeProjection {
  key: PlayerAttributeKey;
  label: string;
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

interface AttributeDefinition {
  key: PlayerAttributeKey;
  label: string;
  metrics: Array<{
    key: PlayerAttributeMetricKey;
    metric: StatsMetricKey;
    weight: number;
  }>;
}

const ATTRIBUTE_DEFINITIONS: readonly AttributeDefinition[] = [
  {
    key: "firepower",
    label: "Firepower",
    metrics: [
      { key: "kpr", metric: "kpr", weight: 0.45 },
      { key: "adr", metric: "adr", weight: 0.40 },
      { key: "multiKillRoundRate", metric: "multiKillRoundRate", weight: 0.15 },
    ],
  },
  {
    key: "entrying",
    label: "Entrying",
    metrics: [
      { key: "tradedDeathRate", metric: "tradedDeathRate", weight: 0.60 },
      { key: "openingDeathTradedRate", metric: "openingDeathTradedRate", weight: 0.40 },
    ],
  },
  {
    key: "trading",
    label: "Trading",
    metrics: [
      { key: "trade", metric: "trade", weight: 0.60 },
      { key: "tradeKillShare", metric: "tradeKillShare", weight: 0.40 },
    ],
  },
  {
    key: "opening",
    label: "Opening",
    metrics: [
      { key: "openingAttempt", metric: "openingAttempt", weight: 0.65 },
      { key: "firstKill", metric: "firstKill", weight: 0.35 },
    ],
  },
  {
    key: "clutching",
    label: "Clutching",
    metrics: [
      { key: "clutchAttemptRate", metric: "clutchAttemptRate", weight: 0.40 },
      { key: "clutch", metric: "clutch", weight: 0.60 },
    ],
  },
  {
    key: "sniping",
    label: "Sniping",
    metrics: [
      { key: "sniperKillShare", metric: "sniperKillShare", weight: 1 },
    ],
  },
  {
    key: "utility",
    label: "Utility",
    metrics: [
      { key: "grenadeUsage", metric: "grenadeUsage", weight: 0.30 },
      { key: "utility", metric: "utility", weight: 0.35 },
      { key: "flashAssist", metric: "flashAssist", weight: 0.35 },
    ],
  },
];

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function weaponKills(player: TournamentPerformancePlayerSummary) {
  return player.weapons.reduce((sum, weapon) => sum + weapon.kills, 0);
}

function sniperKills(player: TournamentPerformancePlayerSummary) {
  return player.weapons
    .filter((weapon) => ["awp", "ssg08", "scout"].includes(weapon.weapon.toLowerCase()))
    .reduce((sum, weapon) => sum + weapon.kills, 0);
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
    case "tradedDeathRate":
      return { value: ratio(slice.trade.tradedDeaths, rounds), sample: rounds };
    case "openingDeathTradedRate":
      return {
        value: ratio(slice.trade.tradedOpeningDeaths, slice.opening.firstDeaths),
        sample: slice.opening.firstDeaths,
      };
    case "trade":
      return { value: slice.trade.tradeKillsPerRound.rate, sample: rounds };
    case "tradeKillShare":
      return { value: ratio(slice.trade.tradeKills, slice.combat.kills), sample: slice.combat.kills };
    case "openingAttempt":
      return { value: slice.opening.attemptRate.rate, sample: rounds };
    case "firstKill":
      return { value: slice.opening.firstKillsPerRound.rate, sample: rounds };
    case "clutchAttemptRate":
      return { value: slice.clutch.frequency.rate, sample: rounds };
    case "clutch":
      return { value: slice.clutch.winRate.rate, sample: slice.clutch.attempts };
    case "sniperKillShare": {
      const totalKills = weaponKills(player);
      return { value: ratio(sniperKills(player), totalKills), sample: totalKills };
    }
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
  }
}

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
  const keys: readonly PlayerAttributeMetricKey[] = [
    "kpr",
    "adr",
    "multiKillRoundRate",
    "tradedDeathRate",
    "openingDeathTradedRate",
    "trade",
    "tradeKillShare",
    "openingAttempt",
    "firstKill",
    "clutchAttemptRate",
    "clutch",
    "sniperKillShare",
    "grenadeUsage",
    "utility",
    "flashAssist",
  ];

  return Object.fromEntries(keys.map((key) => {
    const observations = population.map((player) => getPlayerAttributeMetricObservation(player, key));
    const benchmark = key === "sniperKillShare"
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

  if (key === "sniperKillShare" && observation.value === 0) {
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
  return ATTRIBUTE_DEFINITIONS.map((definition) => {
    const metrics = definition.metrics.map((input): PlayerAttributeMetricProjection => {
      const observation = getPlayerAttributeMetricObservation(player, input.key);
      const projected = projectMetric(player, input.key, benchmarks[input.key]);
      return {
        key: input.key,
        metric: input.metric,
        weight: input.weight,
        value: observation.value,
        sample: observation.sample,
        score: projected?.score ?? null,
        status: projected ? projected.status : "no-data",
        floor: projected?.floor ?? benchmarks[input.key]?.floor.floor ?? null,
      };
    });

    const scored = metrics.filter((metric) => metric.score != null);
    if (scored.length === 0) {
      return {
        key: definition.key,
        label: definition.label,
        score: null,
        status: "no-data",
        rank: null,
        rankedCount: 0,
        metrics,
      };
    }

    const availableWeight = scored.reduce((sum, metric) => sum + metric.weight, 0);
    const score = Math.round(scored.reduce((sum, metric) => sum + metric.score! * metric.weight, 0) / availableWeight);
    const qualified = metrics.length === scored.length && metrics.every((metric) => metric.status === "qualified");

    return {
      key: definition.key,
      label: definition.label,
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
    benchmarkLabel: "RivalHub historical benchmark",
    attributes,
  };
}
