import { describe, expect, it } from "vitest";
import { simulateMajor, replaceSimulationChoice } from "@/lib/predictions/simulator";
import { distributePool } from "@/lib/predictions/rules";
import { SIMULATION_VERSION, type Baseline, type Choices } from "@/lib/predictions/types";
import { projectPredictionStages } from "@/lib/predictions/stage-projection";
import { resolveMarketOptions } from "@/lib/predictions/market-resolution";
import { MAJOR_STAGE_PLAN } from "@/lib/competition/templates";
import { pickEmWindowState } from "@/lib/predictions/lifecycle";
const B = BigInt;
function baseline(): Baseline {
  return {
    version: SIMULATION_VERSION,
    seasonId: "season",
    name: "Major",
    capturedAt: "2026-09-08T00:00:00Z",
    stages: projectPredictionStages(MAJOR_STAGE_PLAN),
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
});

describe("integer pool conservation", () => {
  it("conserves every point, resolves remainder by account id, and aggregates split stakes", () => {
    const positions = [
      { accountId: "a", optionId: "A", stake: B(2) },
      { accountId: "b", optionId: "A", stake: B(1) },
      { accountId: "c", optionId: "B", stake: B(5) },
    ];
    expect(distributePool(positions, ["A"])).toEqual(
      new Map([
        ["a", B(5)],
        ["b", B(3)],
        ["c", B(0)],
      ]),
    );
    expect(
      distributePool(
        [
          { accountId: "a", optionId: "A", stake: B(1) },
          ...positions.map((p) =>
            p.accountId === "a" ? { ...p, stake: B(1) } : p,
          ),
        ],
        ["A"],
      ),
    ).toEqual(distributePool(positions, ["A"]));
  });
  it("refunds cancellation, an empty winning side and single-sided pools", () => {
    const p = [{ accountId: "a", optionId: "A", stake: B(99) }];
    for (const winner of [null, "A", "B"])
      expect(distributePool(p, winner ? [winner] : null).get("a")).toBe(B(99));
  });
  it("has no precision loss beyond Number.MAX_SAFE_INTEGER", () => {
    for (let i = 1; i < 120; i++) {
      const p = [
        { accountId: "a", optionId: "A", stake: B(i) * B("9007199254740993") },
        { accountId: "b", optionId: "A", stake: B(i + 7) },
        { accountId: "c", optionId: "B", stake: B(3 * i + 1) },
      ];
      const result = distributePool(p, ["A"]);
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
          { accountId: "a", optionId: "A", stake: B(1) },
          { accountId: "a", optionId: "B", stake: B(1) },
        ],
        ["A"],
      ),
    ).toThrow();
    expect(() =>
      distributePool([{ accountId: "a", optionId: "A", stake: B(0) }], ["A"]),
    ).toThrow();
  });
});

it("resolves N options and multiple winners without creating a provider settlement path", () => {
  const options = ["A", "B", "C"].map((key) => ({ id: `id-${key}`, key }));
  const resolved = resolveMarketOptions(options, {
    state: "confirmed",
    revision: "confirmed/2",
    winningKeys: ["A", "C"],
  });
  expect(resolved.winningOptionIds).toEqual(["id-A", "id-C"]);
  const payout = distributePool(
    [
      { accountId: "one", optionId: "id-A", stake: B(2) },
      { accountId: "two", optionId: "id-B", stake: B(5) },
      { accountId: "three", optionId: "id-C", stake: B(3) },
    ],
    resolved.winningOptionIds,
  );
  expect([...payout.values()]).toEqual([B(4), B(0), B(6)]);
  expect(
    resolveMarketOptions(options, { state: "pending", revision: "unconfirmed" })
      .state,
  ).toBe("pending");
  expect(() =>
    resolveMarketOptions(options, {
      state: "confirmed",
      revision: "bad",
      winningKeys: ["outside"],
    }),
  ).toThrow();
});

describe("automatic Pick’Em lifecycle", () => {
  it("follows the first scheduled match, allows an unknown deadline and never reopens a closed window", () => {
    const base = baseline();
    const now = new Date("2026-10-07T00:00:00Z");
    const contest = { stageKey: "stage1", deadline: null, lockedAt: null };
    expect(pickEmWindowState(base, contest, now)).toEqual({ deadline: null, locked: false, deadlineTentative: false });
    base.matches = [{ id: "m", stageKey: "stage1", key: "r1-1", round: 1,
      a: "team17", b: "team25", winner: null, scoreA: null, scoreB: null,
      format: "bo1", status: "scheduled", scheduledAt: "2026-10-07T02:00:00Z" }];
    expect(pickEmWindowState(base, contest, now).deadlineTentative).toBe(true);
    const first = base.matches[0]!;
    base.matches = Array.from({ length: 8 }, (_, i) => ({ ...first, id: `m${i}`, key: `r1-${i + 1}` }));
    expect(pickEmWindowState(base, contest, now).deadlineTentative).toBe(false);
    base.matches[7]!.scheduledAt = null;
    expect(pickEmWindowState(base, contest, now).deadlineTentative).toBe(true);
    const early = new Date("2026-10-07T01:00:00Z");
    expect(pickEmWindowState(base, { ...contest, deadline: early }, now).deadline?.toISOString()).toBe("2026-10-07T02:00:00.000Z");
    const elapsed = new Date("2026-10-06T23:00:00Z");
    expect(pickEmWindowState(base, { ...contest, deadline: elapsed }, now)).toEqual({ deadline: elapsed, locked: true, deadlineTentative: false });
    base.matches[0]!.status = "in_progress";
    expect(pickEmWindowState(base, contest, now).locked).toBe(true);
  });
});
