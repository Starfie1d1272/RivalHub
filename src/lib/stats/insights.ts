import { partitionRankingPopulation } from "./ranking";
import { buildMetricBenchmark, projectMetricBenchmarkScore } from "./benchmark";
import { STATS_METRICS, type StatsMetricKey } from "./metrics";

export const INSIGHT_RULES_VERSION = "1";
export type InsightMetric = "fourVFive" | "fiveVFour" | "winAfterOpeningLoss" | "openingDeathTradedRate" | "pistol" | "conversion" | "break" | "blindPerFlash" | "netBlindPerFlash" | "friendlyBlindPerFlash";
export type InsightFamily = "team-manpower" | "player-opening" | "player-utility" | "team-start";
export type InsightRule = "four_v_five_resilience" | "advantage_disadvantage_inversion" | "opening_death_resilience" | "opening_death_traded" | "flash_effectiveness" | "pistol_conversion_contrast" | "second_round_recovery";
export interface InsightFact { kind: "probability" | "amountPerUnit"; x: number; n: number; value: number | null; coverage: string }
export interface InsightEntity {
  key: string; name: string; href: string; type: "player" | "team";
  metrics: Partial<Record<InsightMetric, InsightFact>>;
  flashMaps?: { mapKey: string; enemy: number; friendly: number; flashes: number }[];
}
export interface InsightObservation extends Omit<InsightFact, "coverage"> { metric: InsightMetric; percentile: number; count: number; peerRate?: number; lower?: number }
type ComparableObservation = InsightObservation & { coverage: string };
export interface Insight {
  rule: InsightRule; family: InsightFamily; entityKey: string; entityName: string; entityHref: string;
  text: string; observations: InsightObservation[]; scope: string;
}

/** Display stability only; correlated rounds do not constitute independent trials. */
export function wilsonInterval(x: number, n: number): { lower: number; upper: number } | null {
  if (!Number.isInteger(x) || !Number.isInteger(n) || n <= 0 || x < 0 || x > n) return null;
  const p = x / n, z = 1.96, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { lower: Math.max(0, c - h), upper: Math.min(1, c + h) };
}

const families: InsightFamily[] = ["team-manpower", "player-opening", "player-utility", "team-start"];
const probabilityMetrics: InsightMetric[] = ["fourVFive", "fiveVFour", "winAfterOpeningLoss", "openingDeathTradedRate", "pistol", "conversion", "break"];
const amountMetrics: InsightMetric[] = ["blindPerFlash", "netBlindPerFlash", "friendlyBlindPerFlash"];
const precision = (metric: InsightMetric) => metric === "friendlyBlindPerFlash" ? 2 : STATS_METRICS[metric as StatsMetricKey].precision;
const displayed = (value: number, metric: InsightMetric, kind: InsightFact["kind"]) => Number((value * (kind === "probability" ? 100 : 1)).toFixed(precision(metric)));

export function buildInsights(entities: readonly InsightEntity[], scope: string): Insight[] {
  if (new Set(entities.map((e) => e.key)).size !== entities.length) throw new Error("Duplicate insight entity");
  const comparisons = new Map<InsightMetric, Map<string, ComparableObservation>>();
  const baselines = new Map<InsightMetric, { median: number; floor: number }>();
  for (const metric of [...probabilityMetrics, ...amountMetrics]) {
    const kind = probabilityMetrics.includes(metric) ? "probability" : "amountPerUnit";
    const rows = entities.flatMap((entity) => {
      const fact = entity.metrics[metric];
      if (!fact || fact.kind !== kind || !fact.coverage || fact.value === null || !Number.isFinite(fact.value)
        || !Number.isFinite(fact.x) || !Number.isFinite(fact.n) || fact.n <= 0
        || (kind === "probability" && !wilsonInterval(fact.x, fact.n))) return [];
      return [{ entity, fact }];
    });
    const { ranked } = partitionRankingPopulation(rows, (r) => r.fact.value, (r) => r.fact.n);
    const benchmark = buildMetricBenchmark(rows.map((r) => ({ value: r.fact.value, sample: r.fact.n })));
    if (!benchmark || ranked.length < 4) continue;
    const values = benchmark.qualifiedValues;
    baselines.set(metric, { median: (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2, floor: benchmark.floor.floor });
    const totals = ranked.reduce((sum, r) => ({ x: sum.x + r.fact.x, n: sum.n + r.fact.n }), { x: 0, n: 0 });
    const observations = new Map<string, ComparableObservation>();
    for (const row of ranked) {
      const standing = projectMetricBenchmarkScore({ value: row.fact.value, sample: row.fact.n }, benchmark)!;
      if (kind === "probability") {
        const interval = wilsonInterval(row.fact.x, row.fact.n)!;
        if (interval.upper - interval.lower > 0.5 || totals.n - row.fact.n <= 0) continue;
        observations.set(row.entity.key, { ...row.fact, metric, percentile: standing.percentile, count: ranked.length,
          lower: interval.lower, peerRate: (totals.x - row.fact.x) / (totals.n - row.fact.n) });
      } else observations.set(row.entity.key, { ...row.fact, metric, percentile: standing.percentile, count: ranked.length });
    }
    comparisons.set(metric, observations);
  }
  const get = (entity: InsightEntity, metric: InsightMetric) => comparisons.get(metric)?.get(entity.key);
  const high = (o: ComparableObservation | undefined): o is ComparableObservation => Boolean(o && o.kind === "probability" && o.percentile >= 0.75
    && o.lower! > o.peerRate! && displayed(o.value!, o.metric, o.kind) > displayed(o.peerRate!, o.metric, o.kind));
  const candidates: Insight[] = [];
  const add = (entity: InsightEntity, rule: InsightRule, family: InsightFamily, text: string, observations: ComparableObservation[]) => {
    if (observations.every((o) => o.coverage === observations[0]!.coverage)) candidates.push({ rule, family, entityKey: entity.key, entityName: entity.name, entityHref: entity.href, text, observations: observations.map(({ coverage, ...publicFact }) => { void coverage; return publicFact; }), scope });
  };
  const contrast = (primary: ComparableObservation | undefined, secondary: ComparableObservation | undefined) => high(primary) && secondary && secondary.percentile <= 0.5 && primary.percentile - secondary.percentile >= 0.35;
  for (const entity of entities) {
    if (entity.type === "team") {
      const a = get(entity, "fourVFive"), b = get(entity, "fiveVFour");
      if (contrast(a, b)) add(entity, "advantage_disadvantage_inversion", "team-manpower", "4v5 的相对位置高于 5v4 转化的相对位置", [a!, b!]);
      else if (high(a)) add(entity, "four_v_five_resilience", "team-manpower", "人数劣势回合的取胜比例较突出", [a]);
      const pistol = get(entity, "pistol"), conversion = get(entity, "conversion"), recovery = get(entity, "break");
      if (contrast(pistol, conversion)) add(entity, "pistol_conversion_contrast", "team-start", "手枪局与次回合转化的相对表现存在反差", [pistol!, conversion!]);
      if (contrast(recovery, pistol)) add(entity, "second_round_recovery", "team-start", "手枪失利后，次回合回击相对突出", [recovery!, pistol!]);
    } else {
      const death = get(entity, "winAfterOpeningLoss"), traded = get(entity, "openingDeathTradedRate");
      if (high(death)) add(entity, "opening_death_resilience", "player-opening", `该选手首死的 ${death.n} 个回合，队伍最终赢下 ${death.x} 个`, [death]);
      if (high(traded)) add(entity, "opening_death_traded", "player-opening", "首死后被队友及时补枪的比例较突出", [traded]);
      const enemy = get(entity, "blindPerFlash"), net = get(entity, "netBlindPerFlash"), friendly = get(entity, "friendlyBlindPerFlash");
      if (!enemy || !net || !friendly || enemy.percentile < 0.75 || net.percentile < 0.75 || net.value! <= 0
        || displayed(net.value!, net.metric, net.kind) <= 0 || (friendly.percentile > 0.25 && friendly.x !== 0)) continue;
      const maps = entity.flashMaps?.filter((m) => m.flashes > 0);
      if (!maps || maps.length < 2 || new Set(maps.map((m) => m.mapKey)).size !== maps.length) continue;
      if (maps.reduce((s, m) => s + m.flashes, 0) !== enemy.n) continue;
      const baselineE = baselines.get("blindPerFlash")!, baselineT = baselines.get("friendlyBlindPerFlash")!;
      const stable = maps.every((map) => {
        const f = enemy.n - map.flashes, e = enemy.x - map.enemy, t = friendly.x - map.friendly;
        return f > 0 && f >= baselineE.floor && e - t > 0 && e / f >= baselineE.median && t / f <= baselineT.median;
      });
      if (stable) add(entity, "flash_effectiveness", "player-utility", "对敌致盲产出较高，队友致盲较少", [enemy, net, friendly]);
    }
  }
  return selectInsights(candidates);
}

export function selectInsights(candidates: readonly Insight[]): Insight[] {
  const compare = (a: Insight, b: Insight) => {
    const x = a.observations[0]!, y = b.observations[0]!;
    const flashA = a.observations.find((o) => o.metric === "netBlindPerFlash")?.percentile ?? 0, flashB = b.observations.find((o) => o.metric === "netBlindPerFlash")?.percentile ?? 0;
    return y.percentile - x.percentile || (a.family === "player-utility" && b.family === "player-utility" ? flashB - flashA : ((y.lower ?? 0) - (y.peerRate ?? 0)) - ((x.lower ?? 0) - (x.peerRate ?? 0)))
      || y.n - x.n || a.entityKey.localeCompare(b.entityKey) || a.rule.localeCompare(b.rule);
  };
  const queues = families.map((family) => candidates.filter((c) => c.family === family).sort(compare));
  const result: Insight[] = [], counts = new Map<string, number>(), used = new Set<string>();
  while (queues.some((q) => q.length) && result.length < 6) {
    for (const queue of queues) {
      while (queue.length && result.length < 6) {
        const candidate = queue.shift()!, key = `${candidate.entityKey}:${candidate.family}`;
        if (used.has(key) || (counts.get(candidate.entityKey) ?? 0) >= 2) continue;
        used.add(key); counts.set(candidate.entityKey, (counts.get(candidate.entityKey) ?? 0) + 1); result.push(candidate); break;
      }
    }
  }
  return result;
}
