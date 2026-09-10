import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  distributePool,
  judgePick,
  validatePick,
  coinLevel,
  rulesSchema,
} from "@/lib/predictions/rules";
import {
  simulateMajor,
  replaceSimulationChoice,
} from "@/lib/predictions/simulator";
import {
  SIMULATION_VERSION,
  type Baseline,
  type Choices,
} from "@/lib/predictions/types";
import { MAJOR_STAGE_PLAN } from "@/lib/competition/templates";
const B = BigInt;
function baseline(): Baseline {
  return {
    version: SIMULATION_VERSION,
    seasonId: "season",
    name: "Major",
    capturedAt: "2026-09-08T00:00:00Z",
    stages: MAJOR_STAGE_PLAN.map((s) => ({
      key: s.key,
      name: s.name,
      type: s.type as "swiss" | "single_elim",
      matchFormat: s.matchFormat as "bo1" | "bo3",
      entrySeeds: s.entrySeeds ?? 0,
      finalFormat: s.finalFormat === "bo5" ? "bo5" : null,
    })),
    teams: Array.from({ length: 32 }, (_, i) => ({
      teamId: `team${i + 1}`,
      tournamentSeed: i + 1,
      name: `Team ${i + 1}`,
      logoUrl: null,
    })),
    runs: [],
    matches: [],
  };
}
function complete(base: Baseline) {
  const choices: Choices = {};
  for (let i = 0; i < 110; i++) {
    const stages = simulateMajor(base, choices);
    const stage = stages.find((s) => !s.complete);
    if (!stage) return { stages, choices };
    for (const m of stage.matches.filter((m) => !m.winner))
      choices[`${stage.key}/${m.key}`] = { a: m.a, b: m.b, winner: m.a };
  }
  throw new Error("simulation failed to converge");
}
describe("Major spectator simulation and independent Pick'Em", () => {
  it("completes 32 entrants through three canonical Swiss stages and seven playoff matches", () => {
    const { stages } = complete(baseline());
    expect(stages).toHaveLength(4);
    expect(stages.slice(0, 3).map((s) => s.matches.length)).toEqual([
      33, 33, 33,
    ]);
    expect(stages[3]!.matches).toHaveLength(7);
    for (const s of stages)
      validatePick(
        s.pick!,
        s.entrants,
        s.key === "playoff" ? "single_elim" : "swiss",
        DEFAULT_RULES,
      );
    expect(stages[2]!.matches.every((m) => m.format === "bo3")).toBe(true);
    expect(stages[3]!.matches.at(-1)?.format).toBe("bo5");
  });
  it("replaces upstream choices, discards later rounds/stages, and leaves the input unchanged", () => {
    const base = baseline();
    const { stages, choices } = complete(base);
    const frozen = JSON.stringify(choices);
    const m = stages[0]!.matches[0]!;
    const changed = replaceSimulationChoice(base, choices, "stage1", m, m.b);
    expect(JSON.stringify(choices)).toBe(frozen);
    expect(Object.keys(changed).every((k) => k.startsWith("stage1/r1-"))).toBe(
      true,
    );
    expect(
      simulateMajor(base, changed)[0]!.matches.find((f) => f.key === m.key)
        ?.winner,
    ).toBe(m.b);
    expect(simulateMajor(base, {})[0]!.matches.every((f) => !f.winner)).toBe(
      true,
    );
  });
  it("starts from official winners, overrides explicitly, preserves unaffected same-round facts", () => {
    const base = baseline();
    const rows = simulateMajor(base, {})[0]!.matches;
    base.matches = rows.map((m, i) => ({
      id: String(i),
      stageKey: "stage1",
      key: m.key,
      round: 1,
      a: m.a,
      b: m.b,
      winner: m.a,
      format: "bo1",
      status: "finished",
      scheduledAt: null,
    }));
    const m = rows[0]!;
    const changed = replaceSimulationChoice(base, {}, "stage1", m, m.b);
    const result = simulateMajor(base, changed)[0]!;
    expect(result.matches[0]!.source).toBe("assumption");
    expect(result.matches[1]!.source).toBe("official");
    expect(result.matches.some((m) => m.round === 2)).toBe(true);
  });
  it("preserves the unrelated playoff branch for choices and official results", () => {
    const base = baseline();
    const { stages, choices } = complete(base);
    const playoff = stages[3]!;
    const qf = playoff.matches[0]!;
    const changed = replaceSimulationChoice(
      base,
      choices,
      playoff.key,
      qf,
      qf.b,
    );
    expect(changed["playoff/sf-2"]).toEqual(choices["playoff/sf-2"]);
    expect(changed["playoff/sf-1"]).toBeUndefined();
    expect(changed["playoff/final-1"]).toBeUndefined();
    base.runs = stages.map((s) => ({
      key: s.key,
      entrants: s.entrants,
      finalizedRound: s.key === "playoff" ? 0 : 5,
    }));
    base.matches = stages.flatMap((s) =>
      s.matches.map((m) => ({
        ...m,
        format: m.format as "bo1" | "bo3" | "bo5",
        id: s.key + m.key,
        stageKey: s.key,
        status: "finished",
        scheduledAt: null,
      })),
    );
    const overridden = replaceSimulationChoice(base, {}, playoff.key, qf, qf.b);
    const result = simulateMajor(base, overridden)[3]!;
    expect(result.matches.find((m) => m.key === "sf-2")?.source).toBe(
      "official",
    );
    expect(result.matches.find((m) => m.key === "sf-1")?.winner).toBeNull();
  });
  it("rejects incompatible archived engine versions", () => {
    expect(() => simulateMajor({ ...baseline(), version: 0 }, {})).toThrow(
      "旧版",
    );
  });
  it("ordinary qualification is exact, duplicates invalid, champion evaluated independently", () => {
    const { stages } = complete(baseline());
    const s = stages[0]!;
    const actual = s.pick!;
    if (!("perfect" in actual)) throw Error();
    const pick = {
      ...actual,
      advance: [actual.perfect[0]!, ...actual.advance.slice(1)],
    };
    expect(() =>
      validatePick(pick, s.entrants, "swiss", DEFAULT_RULES),
    ).toThrow("重复");
    expect(judgePick(pick, actual).hits).toBe(9);
    expect(
      judgePick(
        { bracket: ["x", "x", "x", "x", "x", "x", "champ"] },
        { bracket: ["a", "b", "c", "d", "e", "f", "champ"] },
      ),
    ).toEqual({ hits: 1, challenges: [false, false, true] });
  });
  it("coin rules don't grant points and reject incoherent configuration", () => {
    expect(coinLevel(1, 1, DEFAULT_RULES)).toBe("青铜");
    expect(coinLevel(4, 10, DEFAULT_RULES)).toBe("钻石");
    expect(
      rulesSchema.safeParse({ ...DEFAULT_RULES, advance: 8 }).success,
    ).toBe(false);
    expect(DEFAULT_RULES.participationPoints).toBe(0);
  });
});
describe("integer pool conservation", () => {
  it("conserves every point, resolves remainder by account id, and aggregates split stakes", () => {
    const positions = [
      { accountId: "a", side: "A", stake: B(2) },
      { accountId: "b", side: "A", stake: B(1) },
      { accountId: "c", side: "B", stake: B(5) },
    ];
    expect(distributePool(positions, "A")).toEqual(
      new Map([
        ["a", B(5)],
        ["b", B(3)],
        ["c", B(0)],
      ]),
    );
    expect(
      distributePool(
        [
          { accountId: "a", side: "A", stake: B(1) },
          ...positions.map((p) =>
            p.accountId === "a" ? { ...p, stake: B(1) } : p,
          ),
        ],
        "A",
      ),
    ).toEqual(distributePool(positions, "A"));
  });
  it("refunds cancellation, an empty winning side and single-sided pools", () => {
    const p = [{ accountId: "a", side: "A", stake: B(99) }];
    for (const winner of [null, "A", "B"])
      expect(distributePool(p, winner).get("a")).toBe(B(99));
  });
  it("has no precision loss beyond Number.MAX_SAFE_INTEGER", () => {
    for (let i = 1; i < 120; i++) {
      const p = [
        { accountId: "a", side: "A", stake: B(i) * B("9007199254740993") },
        { accountId: "b", side: "A", stake: B(i + 7) },
        { accountId: "c", side: "B", stake: B(3 * i + 1) },
      ];
      const result = distributePool(p, "A");
      expect([...result.values()].reduce((a, b) => a + b, B(0))).toBe(
        p.reduce((a, b) => a + b.stake, B(0)),
      );
      expect([...result.values()].every((v) => v >= B(0))).toBe(true);
    }
  });
  it("rejects changing sides and nonpositive stakes", () => {
    expect(() =>
      distributePool(
        [
          { accountId: "a", side: "A", stake: B(1) },
          { accountId: "a", side: "B", stake: B(1) },
        ],
        "A",
      ),
    ).toThrow();
    expect(() =>
      distributePool([{ accountId: "a", side: "A", stake: B(0) }], "A"),
    ).toThrow();
  });
});
