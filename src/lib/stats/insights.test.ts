import { describe, expect, it } from "vitest";
import { buildInsights, selectInsights, wilsonInterval, type InsightEntity, type InsightFact, type InsightMetric } from "./insights";
const probability = (x: number, n = 100, coverage = "same-map-set"): InsightFact => ({ kind: "probability", x, n, value: n ? x / n : null, coverage });
const amount = (x: number, n = 100): InsightFact => ({ kind: "amountPerUnit", x, n, value: n ? x / n : null, coverage: "same-map-set" });
function population(type: "team" | "player", primary: InsightMetric, secondary?: InsightMetric): InsightEntity[] {
  return [90, 10, 20, 30].map((x, i) => ({ key: `${type}:${i}`, name: `对象${i}`, type, href: "/stats", metrics: {
    [primary]: probability(x), ...(secondary ? { [secondary]: probability([10, 60, 70, 80][i]!) } : {}),
  } }));
}
function flashPopulation(): InsightEntity[] {
  return [6, 2, 3, 4].map((enemy, i) => ({ key: `player:${i}`, name: `选手${i}`, type: "player", href: "/stats", metrics: {
    blindPerFlash: amount(enemy * 100), netBlindPerFlash: amount(enemy * 100 - i * 100), friendlyBlindPerFlash: amount(i * 100),
  }, flashMaps: ["a", "b"].map((mapKey) => ({ mapKey, enemy: enemy * 50, friendly: i * 50, flashes: 50 })) }));
}
describe("Insight rules v1", () => {
  it.each([
    ["team", "fourVFive", undefined, "four_v_five_resilience"],
    ["team", "fourVFive", "fiveVFour", "advantage_disadvantage_inversion"],
    ["player", "winAfterOpeningLoss", undefined, "opening_death_resilience"],
    ["player", "openingDeathTradedRate", undefined, "opening_death_traded"],
    ["team", "pistol", "conversion", "pistol_conversion_contrast"],
    ["team", "break", "pistol", "second_round_recovery"],
  ] as const)("fires %s %s with explicit independent denominators", (type, primary, secondary, rule) => {
    const result = buildInsights(population(type, primary, secondary), "公开测试范围");
    expect(result.map((r) => r.rule)).toEqual([rule]);
    expect(result[0]?.observations[0]).toMatchObject({ x: 90, n: 100, count: 4, peerRate: 0.2, percentile: 0.875 });
    expect(result[0]?.observations[0]).not.toHaveProperty("coverage");
  });
  it("never recommends tiny samples, ties, missing denominators, or N < 4", () => {
    expect(wilsonInterval(1, 1)!.upper - wilsonInterval(1, 1)!.lower).toBeGreaterThan(0.5);
    expect(wilsonInterval(2, 2)!.upper - wilsonInterval(2, 2)!.lower).toBeGreaterThan(0.5);
    expect(wilsonInterval(2, 1)).toBeNull();
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(-1, 10)).toBeNull();
    const rows = population("team", "fourVFive");
    expect(buildInsights(rows.slice(0, 3), "all")).toEqual([]);
    for (const row of rows) row.metrics.fourVFive = probability(20);
    expect(buildInsights(rows, "all")).toEqual([]);
    rows[0]!.metrics.fourVFive = probability(2, 2);
    expect(buildInsights(rows, "all")).toEqual([]);
    rows[0]!.metrics.fourVFive = probability(0, 0);
    expect(buildInsights(rows, "all")).toEqual([]);
  });
  it("uses the shared P75 qualification floor before building the comparison population", () => {
    const rows = population("team", "fourVFive");
    rows[0]!.metrics.fourVFive = probability(22, 24);
    expect(buildInsights(rows, "all")).toEqual([]); // P75=100 => floor=25; N drops to 3.
    rows[0]!.metrics.fourVFive = probability(23, 25);
    expect(buildInsights(rows, "all").map((row) => row.rule)).toEqual(["four_v_five_resilience"]);
  });
  it("suppresses combinations with different coverage and insufficient R2 opportunities", () => {
    const rows = population("team", "pistol", "conversion");
    rows[0]!.metrics.conversion = probability(1, 2);
    expect(buildInsights(rows, "all")).toEqual([]);
    rows[0]!.metrics.conversion = probability(10, 100, "different-map-set");
    expect(buildInsights(rows, "all")).toEqual([]);
  });
  it("rejects display-invisible rate differences and incorrect amount/probability mixing", () => {
    const rows = population("team", "fourVFive");
    rows[0]!.metrics.fourVFive = amount(9000);
    expect(buildInsights(rows, "all")).toEqual([]);
    for (const [i, row] of rows.entries()) row.metrics.fourVFive = probability(1000000 + i, 2000000);
    expect(buildInsights(rows, "all")).toEqual([]);
  });
  it("supports continuous flash output > 1, fixed baselines and all-zero friendly ties", () => {
    const rows = flashPopulation();
    expect(buildInsights(rows, "all").map((r) => r.rule)).toEqual(["flash_effectiveness"]);
    for (const row of rows) { row.metrics.friendlyBlindPerFlash = amount(0); row.metrics.netBlindPerFlash = row.metrics.blindPerFlash; row.flashMaps!.forEach((m) => { m.friendly = 0; }); }
    expect(buildInsights(rows, "all").map((r) => r.rule)).toEqual(["flash_effectiveness"]);
  });
  it("suppresses flash spikes, one-map support, unknown T and high friendly blind despite high net", () => {
    const rows = flashPopulation();
    rows[0]!.flashMaps = [{ mapKey: "a", enemy: 599, friendly: 0, flashes: 50 }, { mapKey: "b", enemy: 1, friendly: 0, flashes: 50 }];
    expect(buildInsights(rows, "all")).toEqual([]);
    rows[0]!.flashMaps = [{ mapKey: "a", enemy: 600, friendly: 0, flashes: 100 }];
    expect(buildInsights(rows, "all")).toEqual([]);
    delete rows[0]!.metrics.friendlyBlindPerFlash;
    expect(buildInsights(rows, "all")).toEqual([]);
    rows[0]!.metrics = { blindPerFlash: amount(10000), netBlindPerFlash: amount(5000), friendlyBlindPerFlash: amount(5000) };
    rows[0]!.flashMaps = ["a", "b"].map((mapKey) => ({ mapKey, enemy: 5000, friendly: 2500, flashes: 50 }));
    expect(buildInsights(rows, "all")).toEqual([]);
  });
  it("deduplicates opening family, caps entities, and round-robins families deterministically", () => {
    const teams = population("team", "fourVFive", "fiveVFour");
    const players = population("player", "winAfterOpeningLoss", "openingDeathTradedRate");
    players.forEach((p, i) => { p.metrics.openingDeathTradedRate = probability([95, 10, 20, 30][i]!); });
    const candidates = [...buildInsights(teams, "all"), ...buildInsights(players, "all"), ...buildInsights(flashPopulation(), "all")];
    const selected = selectInsights([...candidates].reverse());
    expect(selected.map((r) => r.family)).toEqual(["team-manpower", "player-opening", "player-utility"]);
    expect(selected.filter((r) => r.entityKey === "player:0")).toHaveLength(2);
    expect(selected.find((r) => r.family === "player-opening")?.rule).toBe("opening_death_traded");
    expect(buildInsights(teams, "all").some((r) => r.rule === "four_v_five_resilience")).toBe(false);
    expect(() => buildInsights([teams[0]!, teams[0]!], "all")).toThrow("Duplicate insight entity");
  });
});
