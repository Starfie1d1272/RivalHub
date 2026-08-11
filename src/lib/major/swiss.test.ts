import { describe, expect, it } from "vitest";
import {
  MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS,
  generateNextMajorSwissRound,
  getMajorSwissQualifiers,
  getMajorSwissRequiredFormat,
  projectMajorSwissStage,
  selectMajorSixTeamPairingPattern,
} from "./swiss";
import type {
  MajorSwissEntrant,
  MajorSwissFinalizedRound,
  MajorSwissMatchFact,
  MajorSwissMatchFormat,
  MajorSwissPairing,
  MajorSwissRecord,
  MajorSwissRound,
} from "./swiss";
// ── helpers ─────────────────────────────────────────────

function makeEntrants(): MajorSwissEntrant[] {
  return Array.from({ length: 16 }, (_, i) => ({
    teamId: `team-${i + 1}`,
    initialStageSeed: i + 1,
  }));
}

function match(
  round: number,
  index: number,
  teamAId: string,
  teamBId: string,
  winnerId: string,
): MajorSwissMatchFact {
  return {
    matchId: `r${round}-m${index}`,
    round: round as MajorSwissRound,
    teamAId,
    teamBId,
    winnerId,
  };
}

const HIGH_WINS_R1 = [
  "team-1",
  "team-2",
  "team-3",
  "team-4",
  "team-5",
  "team-6",
  "team-7",
  "team-8",
];

function roundOneMatches(winners: readonly string[] = HIGH_WINS_R1): MajorSwissMatchFact[] {
  const pairs: readonly (readonly [string, string])[] = [
    ["team-1", "team-9"],
    ["team-2", "team-10"],
    ["team-3", "team-11"],
    ["team-4", "team-12"],
    ["team-5", "team-13"],
    ["team-6", "team-14"],
    ["team-7", "team-15"],
    ["team-8", "team-16"],
  ];
  return pairs.map(([teamA, teamB], i) => match(1, i + 1, teamA, teamB, winners[i]));
}

// 基于 R1 高 seed 全赢后的 1-0 / 0-1 分组
function roundTwoMatches(winners: readonly string[]): MajorSwissMatchFact[] {
  const pairs: readonly (readonly [string, string])[] = [
    ["team-1", "team-8"],
    ["team-2", "team-7"],
    ["team-3", "team-6"],
    ["team-4", "team-5"],
    ["team-9", "team-16"],
    ["team-10", "team-15"],
    ["team-11", "team-14"],
    ["team-12", "team-13"],
  ];
  return pairs.map(([teamA, teamB], i) => match(2, i + 1, teamA, teamB, winners[i]));
}

// deterministic LCG（避免 Math.random）
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const ROUND_MATCH_COUNT: Record<number, number> = { 1: 8, 2: 8, 3: 8, 4: 6, 5: 3 };

const ROUND_FORMATS: Record<number, Record<MajorSwissMatchFormat, number>> = {
  1: { bo1: 8, bo3: 0 },
  2: { bo1: 8, bo3: 0 },
  3: { bo1: 4, bo3: 4 },
  4: { bo1: 0, bo3: 6 },
  5: { bo1: 0, bo3: 3 },
};

interface SimulationResult {
  matches: MajorSwissMatchFact[];
  countsPerRound: { active: number; advanced: number; eliminated: number }[];
}

// 完整 5 轮 tournament simulation，内含每轮 invariant 断言。
// 不吞掉 generateNextMajorSwissRound 的任何异常（任意 throw → 测试失败）。
function runTournament(rng: () => number): SimulationResult {
  const entrants = makeEntrants();
  const matches: MajorSwissMatchFact[] = [];
  const countsPerRound: SimulationResult["countsPerRound"] = [];

  for (let round = 1; round <= 5; round += 1) {
    const finalizedRound = (round - 1) as MajorSwissFinalizedRound;
    const projection = projectMajorSwissStage({ entrants, matches, finalizedRound });
    const pairings = generateNextMajorSwissRound({ entrants, matches, finalizedRound });

    expect(pairings.length).toBe(ROUND_MATCH_COUNT[round]);

    const byId = new Map(projection.teams.map((team) => [team.teamId, team]));
    const formats: Record<MajorSwissMatchFormat, number> = { bo1: 0, bo3: 0 };
    for (const pairing of pairings) {
      const higher = byId.get(pairing.higherSeedTeamId)!;
      const lower = byId.get(pairing.lowerSeedTeamId)!;
      // 双方 pre-match record 相同
      expect(higher.wins).toBe(pairing.record.wins);
      expect(higher.losses).toBe(pairing.record.losses);
      expect(lower.wins).toBe(pairing.record.wins);
      expect(lower.losses).toBe(pairing.record.losses);
      // 不产生 rematch
      expect(higher.opponents).not.toContain(pairing.lowerSeedTeamId);
      expect(lower.opponents).not.toContain(pairing.higherSeedTeamId);
      expect(pairing.format).toBe(getMajorSwissRequiredFormat(pairing.record));
      formats[pairing.format] += 1;
    }
    expect(formats).toEqual(ROUND_FORMATS[round]);

    for (let i = 0; i < pairings.length; i += 1) {
      const pairing = pairings[i];
      matches.push({
        matchId: `r${round}-m${i + 1}`,
        round: round as MajorSwissRound,
        teamAId: pairing.higherSeedTeamId,
        teamBId: pairing.lowerSeedTeamId,
        winnerId: rng() < 0.5 ? pairing.higherSeedTeamId : pairing.lowerSeedTeamId,
      });
    }

    const afterRound = projectMajorSwissStage({
      entrants,
      matches,
      finalizedRound: round as MajorSwissFinalizedRound,
    });
    countsPerRound.push({
      active: afterRound.active.length,
      advanced: afterRound.advanced.length,
      eliminated: afterRound.eliminated.length,
    });
  }

  expect(matches).toHaveLength(33);

  const final = projectMajorSwissStage({ entrants, matches, finalizedRound: 5 });
  expect(final.active).toHaveLength(0);
  expect(final.advanced).toHaveLength(8);
  expect(final.eliminated).toHaveLength(8);
  expect(final.isComplete).toBe(true);
  expect(final.teams.map((team) => team.currentStageSeed)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]);
  for (const team of final.teams) {
    // 每队最多 5 场
    expect(team.opponents.length).toBeLessThanOrEqual(5);
    // 无重复对手
    expect(new Set(team.opponents).size).toBe(team.opponents.length);
  }

  const perRoundCounts: Record<number, number> = {};
  for (const m of matches) perRoundCounts[m.round] = (perRoundCounts[m.round] ?? 0) + 1;
  expect(perRoundCounts).toEqual({ 1: 8, 2: 8, 3: 8, 4: 6, 5: 3 });

  const qualifiers = getMajorSwissQualifiers(final);
  expect(qualifiers).toHaveLength(8);
  expect(qualifiers.map((q) => q.finalStageSeed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

  return { matches, countsPerRound };
}

const SIX_IDS = ["a", "b", "c", "d", "e", "f"];

// ── 10.1 entrant validation ─────────────────────────────

describe("entrant validation", () => {
  it("accepts 16 valid entrants", () => {
    const projection = projectMajorSwissStage({
      entrants: makeEntrants(),
      matches: [],
      finalizedRound: 0,
    });
    expect(projection.teams).toHaveLength(16);
  });

  it("throws on 15 entrants", () => {
    expect(() =>
      projectMajorSwissStage({ entrants: makeEntrants().slice(0, 15), matches: [], finalizedRound: 0 }),
    ).toThrow();
  });

  it("throws on 17 entrants", () => {
    const extra: MajorSwissEntrant = { teamId: "team-17", initialStageSeed: 17 };
    expect(() =>
      projectMajorSwissStage({
        entrants: [...makeEntrants(), extra],
        matches: [],
        finalizedRound: 0,
      }),
    ).toThrow();
  });

  it("throws on duplicate teamId", () => {
    const dup = makeEntrants();
    dup[15] = { ...dup[15], teamId: "team-1" };
    expect(() => projectMajorSwissStage({ entrants: dup, matches: [], finalizedRound: 0 })).toThrow();
  });

  it("throws on empty teamId", () => {
    const bad = makeEntrants();
    bad[0] = { ...bad[0], teamId: "" };
    expect(() => projectMajorSwissStage({ entrants: bad, matches: [], finalizedRound: 0 })).toThrow();
  });

  it("throws on duplicate initialStageSeed", () => {
    const dup = makeEntrants();
    dup[15] = { ...dup[15], initialStageSeed: 1 };
    expect(() => projectMajorSwissStage({ entrants: dup, matches: [], finalizedRound: 0 })).toThrow();
  });

  it("throws on seed 0", () => {
    const bad = makeEntrants();
    bad[15] = { ...bad[15], initialStageSeed: 0 };
    expect(() => projectMajorSwissStage({ entrants: bad, matches: [], finalizedRound: 0 })).toThrow();
  });

  it("throws on seed 17", () => {
    const bad = makeEntrants();
    bad[15] = { ...bad[15], initialStageSeed: 17 };
    expect(() => projectMajorSwissStage({ entrants: bad, matches: [], finalizedRound: 0 })).toThrow();
  });

  it("throws on non-integer seed", () => {
    const bad = makeEntrants();
    bad[15] = { ...bad[15], initialStageSeed: 1.5 };
    expect(() => projectMajorSwissStage({ entrants: bad, matches: [], finalizedRound: 0 })).toThrow();
  });

  it("throws when a seed in 1..16 is missing", () => {
    // 16 个 entrant，但 seed 集合 = {1..15, 1} → 缺 16
    const bad = makeEntrants();
    bad[15] = { ...bad[15], initialStageSeed: 1 };
    expect(() => projectMajorSwissStage({ entrants: bad, matches: [], finalizedRound: 0 })).toThrow();
  });
});

// ── 10.2 round 0 projection ─────────────────────────────

describe("round 0 projection", () => {
  it("projects 16 teams at 0-0 with difficulty 0", () => {
    const projection = projectMajorSwissStage({
      entrants: makeEntrants(),
      matches: [],
      finalizedRound: 0,
    });
    expect(projection.teams).toHaveLength(16);
    for (const team of projection.teams) {
      expect(team.wins).toBe(0);
      expect(team.losses).toBe(0);
      expect(team.difficultyScore).toBe(0);
      expect(team.status).toBe("active");
      expect(team.currentStageSeed).toBe(team.initialStageSeed);
      expect(team.opponents).toEqual([]);
    }
    expect(projection.active).toHaveLength(16);
    expect(projection.advanced).toHaveLength(0);
    expect(projection.eliminated).toHaveLength(0);
    expect(projection.isComplete).toBe(false);
  });
});

// ── 10.3 exact round 1 ──────────────────────────────────

describe("round 1 generation", () => {
  it("pairs 1v9 .. 8v16 with record 0-0, bo1, initial rule", () => {
    const pairings = generateNextMajorSwissRound({
      entrants: makeEntrants(),
      matches: [],
      finalizedRound: 0,
    });
    expect(pairings).toHaveLength(8);
    const expected: readonly (readonly [string, string])[] = [
      ["team-1", "team-9"],
      ["team-2", "team-10"],
      ["team-3", "team-11"],
      ["team-4", "team-12"],
      ["team-5", "team-13"],
      ["team-6", "team-14"],
      ["team-7", "team-15"],
      ["team-8", "team-16"],
    ];
    pairings.forEach((pairing, i) => {
      expect(pairing.round).toBe(1);
      expect(pairing.higherSeedTeamId).toBe(expected[i][0]);
      expect(pairing.lowerSeedTeamId).toBe(expected[i][1]);
      expect(pairing.higherSeed).toBe(i + 1);
      expect(pairing.lowerSeed).toBe(i + 9);
      expect(pairing.record).toEqual({ wins: 0, losses: 0 });
      expect(pairing.format).toBe("bo1");
      expect(pairing.pairingRule).toBe("initial");
      expect(pairing.priority).toBeUndefined();
    });
  });

  it("throws when generating after the stage is complete", () => {
    const rng = makeRng(7);
    const { matches } = runTournament(rng);
    expect(() =>
      generateNextMajorSwissRound({
        entrants: makeEntrants(),
        matches,
        finalizedRound: 5,
      }),
    ).toThrow();
  });
});

// ── 10.4 projection ignores unfinalized results ─────────

describe("unfinalized results are ignored", () => {
  it("a round 2 fact with a winner does not affect a finalizedRound=1 projection", () => {
    const entrants = makeEntrants();
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const rogue = match(2, 1, "team-1", "team-8", "team-8");

    const base = projectMajorSwissStage({ entrants, matches: r1, finalizedRound: 1 });
    const withRogue = projectMajorSwissStage({
      entrants,
      matches: [...r1, rogue],
      finalizedRound: 1,
    });

    expect(withRogue).toEqual(base);
    expect(withRogue.teams.find((t) => t.teamId === "team-1")!.wins).toBe(1);
    expect(withRogue.teams.find((t) => t.teamId === "team-1")!.opponents).toEqual(["team-9"]);
  });

  it("even an invalid unfinalized fact is ignored", () => {
    const entrants = makeEntrants();
    const r1 = roundOneMatches(HIGH_WINS_R1);
    // winner 不是参与者 —— 但 round 2 > finalizedRound 1，必须完全忽略
    const rogue = match(2, 1, "team-1", "team-8", "team-99");
    const base = projectMajorSwissStage({ entrants, matches: r1, finalizedRound: 1 });
    const withRogue = projectMajorSwissStage({
      entrants,
      matches: [...r1, rogue],
      finalizedRound: 1,
    });
    expect(withRogue).toEqual(base);
  });
});

// ── 10.5 finalized round completeness ───────────────────

describe("finalized round completeness", () => {
  const entrants = makeEntrants();

  it("throws when a finalized round is missing matches (7 of 8)", () => {
    const incomplete = roundOneMatches(HIGH_WINS_R1).slice(0, 7);
    expect(() =>
      projectMajorSwissStage({ entrants, matches: incomplete, finalizedRound: 1 }),
    ).toThrow();
  });

  it("throws when a team appears twice in the same round", () => {
    const dupTeam = [
      match(1, 1, "team-1", "team-9", "team-1"),
      match(1, 2, "team-1", "team-10", "team-1"),
      match(1, 3, "team-2", "team-11", "team-2"),
      match(1, 4, "team-3", "team-12", "team-3"),
      match(1, 5, "team-4", "team-13", "team-4"),
      match(1, 6, "team-5", "team-14", "team-5"),
      match(1, 7, "team-6", "team-15", "team-6"),
      match(1, 8, "team-7", "team-16", "team-7"),
    ];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: dupTeam, finalizedRound: 1 }),
    ).toThrow();
  });

  it("throws on unknown team", () => {
    const withUnknown = [
      ...roundOneMatches(HIGH_WINS_R1).slice(0, 7),
      match(1, 8, "team-8", "team-99", "team-8"),
    ];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: withUnknown, finalizedRound: 1 }),
    ).toThrow();
  });

  it("throws when winner is not a participant", () => {
    const badWinner = [
      ...roundOneMatches(HIGH_WINS_R1).slice(0, 7),
      match(1, 8, "team-8", "team-16", "team-1"),
    ];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: badWinner, finalizedRound: 1 }),
    ).toThrow();
  });

  it("throws on self match", () => {
    const selfMatch = [
      ...roundOneMatches(HIGH_WINS_R1).slice(0, 7),
      match(1, 8, "team-8", "team-8", "team-8"),
    ];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: selfMatch, finalizedRound: 1 }),
    ).toThrow();
  });

  it("throws on cross-record match", () => {
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const r2Cross = [
      match(2, 1, "team-1", "team-9", "team-1"), // 1-0 vs 0-1
      match(2, 2, "team-2", "team-7", "team-2"),
      match(2, 3, "team-3", "team-6", "team-3"),
      match(2, 4, "team-4", "team-5", "team-4"),
      match(2, 5, "team-8", "team-16", "team-8"),
      match(2, 6, "team-10", "team-15", "team-10"),
      match(2, 7, "team-11", "team-14", "team-11"),
      match(2, 8, "team-12", "team-13", "team-12"),
    ];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: [...r1, ...r2Cross], finalizedRound: 2 }),
    ).toThrow();
  });

  it("throws on duplicate matchId", () => {
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const dup = [
      ...r1.slice(0, 7),
      { ...r1[7], matchId: r1[0].matchId },
    ];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: dup, finalizedRound: 1 }),
    ).toThrow();
  });

  it("throws on invalid match round within the finalized range", () => {
    const badRound = [match(0, 1, "team-1", "team-9", "team-1")];
    expect(() =>
      projectMajorSwissStage({ entrants, matches: badRound, finalizedRound: 0 }),
    ).toThrow();
  });
});

// ── 10.6 difficulty score ───────────────────────────────

describe("difficulty score", () => {
  const entrants = makeEntrants();

  // R1: 高 seed 全赢 → 1-0: {1..8}, 0-1: {9..16}
  // R2: winners [1,2,3,4,9,10,11,12]
  // R3: winners [1,2,5,6,7,8,13,14]
  function buildR1R2R3(): MajorSwissMatchFact[] {
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const r2 = roundTwoMatches(["team-1", "team-2", "team-3", "team-4", "team-9", "team-10", "team-11", "team-12"]);

    const r3Pairings = generateNextMajorSwissRound({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });
    expect(r3Pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-1", "team-4"],
      ["team-2", "team-3"],
      ["team-5", "team-12"],
      ["team-6", "team-11"],
      ["team-7", "team-10"],
      ["team-8", "team-9"],
      ["team-13", "team-16"],
      ["team-14", "team-15"],
    ]);
    const r3Winners = ["team-1", "team-2", "team-5", "team-6", "team-7", "team-8", "team-13", "team-14"];
    const r3 = r3Pairings.map((p, i) =>
      match(3, i + 1, p.higherSeedTeamId, p.lowerSeedTeamId, r3Winners[i]),
    );
    return [...r1, ...r2, ...r3];
  }

  it("computes exact difficulty for hand-calculated teams", () => {
    const facts = buildR1R2R3();
    const projection = projectMajorSwissStage({ entrants, matches: facts, finalizedRound: 3 });

    const byId = new Map(projection.teams.map((t) => [t.teamId, t]));
    expect(byId.get("team-1")!.difficultyScore).toBe(1); // 9(1-2) + 8(2-1) + 4(2-1) = -1+1+1
    expect(byId.get("team-3")!.difficultyScore).toBe(3); // 11(1-2) + 6(2-1) + 2(3-0) = -1+1+3
    expect(byId.get("team-5")!.difficultyScore).toBe(-1); // 13(1-2) + 4(2-1) + 12(1-2) = -1+1-1
    expect(byId.get("team-9")!.difficultyScore).toBe(1); // 1(3-0) + 16(0-3) + 8(2-1) = 3-3+1
    expect(byId.get("team-13")!.difficultyScore).toBe(-3); // 5(2-1) + 12(1-2) + 16(0-3) = 1-1-3
    expect(byId.get("team-15")!.difficultyScore).toBe(-1); // 7(2-1) + 10(1-2) + 14(1-2) = 1-1-1

    // status 与 opponents 顺序
    expect(byId.get("team-1")!.status).toBe("advanced");
    expect(byId.get("team-1")!.opponents).toEqual(["team-9", "team-8", "team-4"]);
    expect(byId.get("team-15")!.status).toBe("eliminated");
  });

  it("does not freeze difficulty for advanced teams after later rounds", () => {
    const facts = buildR1R2R3();
    const proj3 = projectMajorSwissStage({ entrants, matches: facts, finalizedRound: 3 });
    expect(proj3.teams.find((t) => t.teamId === "team-1")!.difficultyScore).toBe(1);

    // R4：2-1 group {3,4,5,6,7,8} → priority 1（3v8, 4v7, 5v6）
    //      1-2 group（difficulty 9/10/11/12=1, 13/14=-3 → seed 序 9,10,11,12,13,14）
    //      → priority 1（9v14, 10v13, 11v12）合法，无 rematch
    const r4Pairings = generateNextMajorSwissRound({ entrants, matches: facts, finalizedRound: 3 });
    expect(r4Pairings.map((p) => p.priority)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(r4Pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-3", "team-8"],
      ["team-4", "team-7"],
      ["team-5", "team-6"],
      ["team-9", "team-14"],
      ["team-10", "team-13"],
      ["team-11", "team-12"],
    ]);
    const r4Winners = ["team-3", "team-4", "team-5", "team-9", "team-10", "team-11"];
    const r4 = r4Pairings.map((p, i) =>
      match(4, i + 1, p.higherSeedTeamId, p.lowerSeedTeamId, r4Winners[i]),
    );

    const proj4 = projectMajorSwissStage({
      entrants,
      matches: [...facts, ...r4],
      finalizedRound: 4,
    });
    const team1 = proj4.teams.find((t) => t.teamId === "team-1")!;
    expect(team1.status).toBe("advanced");
    // 对手 9(2-2) + 8(2-2) + 4(3-1) = 0+0+2 —— advanced 后 Difficulty 仍随投影更新
    expect(team1.difficultyScore).toBe(2);

    expect(proj4.active).toHaveLength(6);
    expect(proj4.advanced).toHaveLength(5);
    expect(proj4.eliminated).toHaveLength(5);
  });
});

// ── 10.7 / 10.8 R2/R3 high-low + rematch avoidance ─────

describe("R2/R3 high-low pairing", () => {
  const entrants = makeEntrants();

  it("generates exact R2 pairings from a finished R1", () => {
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const pairings = generateNextMajorSwissRound({ entrants, matches: r1, finalizedRound: 1 });
    expect(pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-1", "team-8"],
      ["team-2", "team-7"],
      ["team-3", "team-6"],
      ["team-4", "team-5"],
      ["team-9", "team-16"],
      ["team-10", "team-15"],
      ["team-11", "team-14"],
      ["team-12", "team-13"],
    ]);
    expect(pairings.every((p) => p.pairingRule === "high-low")).toBe(true);
    expect(pairings.every((p) => p.record.wins === 1 || p.record.wins === 0)).toBe(true);
    expect(pairings.filter((p) => p.record.wins === 1)).toHaveLength(4);
    expect(pairings.filter((p) => p.record.wins === 0)).toHaveLength(4);
  });

  it("pairs each record group highest-vs-lowest with matching records", () => {
    // R2 winners [1,2,3,4,9,10,11,12] → 2-0: {1,2,3,4}, 1-1: {5..12}, 0-2: {13..16}
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const r2 = roundTwoMatches(["team-1", "team-2", "team-3", "team-4", "team-9", "team-10", "team-11", "team-12"]);
    const pairings = generateNextMajorSwissRound({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });

    expect(pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-1", "team-4"],
      ["team-2", "team-3"],
      ["team-5", "team-12"],
      ["team-6", "team-11"],
      ["team-7", "team-10"],
      ["team-8", "team-9"],
      ["team-13", "team-16"],
      ["team-14", "team-15"],
    ]);
    const records = pairings.map((p) => `${p.record.wins}-${p.record.losses}`);
    expect(records).toEqual(["2-0", "2-0", "1-1", "1-1", "1-1", "1-1", "0-2", "0-2"]);
    // 组内同 record；全部 non-rematch
    const projection = projectMajorSwissStage({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });
    const byId = new Map(projection.teams.map((t) => [t.teamId, t]));
    for (const pairing of pairings) {
      const higher = byId.get(pairing.higherSeedTeamId)!;
      const lower = byId.get(pairing.lowerSeedTeamId)!;
      expect(higher.opponents).not.toContain(pairing.lowerSeedTeamId);
      expect(higher.wins).toBe(pairing.record.wins);
      expect(lower.wins).toBe(pairing.record.wins);
    }
  });

  it("avoids rematch: skips the lowest seed already played by the highest", () => {
    // R2 winners [1,2,3,5,9,10,11,12]（4 输给 5）→
    // 1-1: {4,6,7,8,9,10,11,12}；4 与 12 在 R1 打过（4v12）→ rematch 跳过，
    // 11 是 lowest feasible（选中后剩余 {6,7,8,9,10,12} 可完整配对：6-12, 7-10, 8-9）
    // → 4 配对 11。
    const r1 = roundOneMatches(HIGH_WINS_R1);
    const r2 = roundTwoMatches(["team-1", "team-2", "team-3", "team-5", "team-9", "team-10", "team-11", "team-12"]);
    const pairings = generateNextMajorSwissRound({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });

    const byHigher = new Map(pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId]));
    expect(byHigher.get("team-4")).toBe("team-11");
    expect(byHigher.get("team-6")).toBe("team-12");
    expect(pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-1", "team-5"],
      ["team-2", "team-3"],
      ["team-4", "team-11"],
      ["team-6", "team-12"],
      ["team-7", "team-10"],
      ["team-8", "team-9"],
      ["team-13", "team-16"],
      ["team-14", "team-15"],
    ]);
    // 不跨 record：2-0 与 0-2 各 2 场，1-1 组 4 场
    for (const pairing of pairings) {
      const recordKey = `${pairing.record.wins}-${pairing.record.losses}`;
      const sameRecordCount = pairings.filter(
        (p) => `${p.record.wins}-${p.record.losses}` === recordKey,
      ).length;
      expect(sameRecordCount).toBe(recordKey === "1-1" ? 4 : 2);
    }
  });
});

// ── 10.9 six-team priority patterns ─────────────────────

describe("six-team priority patterns", () => {
  it("MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS matches the frozen 15 patterns", () => {
    const expected = [
      { priority: 1, pairs: [[1, 6], [2, 5], [3, 4]] },
      { priority: 2, pairs: [[1, 6], [2, 4], [3, 5]] },
      { priority: 3, pairs: [[1, 5], [2, 6], [3, 4]] },
      { priority: 4, pairs: [[1, 5], [2, 4], [3, 6]] },
      { priority: 5, pairs: [[1, 4], [2, 6], [3, 5]] },
      { priority: 6, pairs: [[1, 4], [2, 5], [3, 6]] },
      { priority: 7, pairs: [[1, 6], [2, 3], [4, 5]] },
      { priority: 8, pairs: [[1, 5], [2, 3], [4, 6]] },
      { priority: 9, pairs: [[1, 3], [2, 6], [4, 5]] },
      { priority: 10, pairs: [[1, 3], [2, 5], [4, 6]] },
      { priority: 11, pairs: [[1, 4], [2, 3], [5, 6]] },
      { priority: 12, pairs: [[1, 3], [2, 4], [5, 6]] },
      { priority: 13, pairs: [[1, 2], [3, 6], [4, 5]] },
      { priority: 14, pairs: [[1, 2], [3, 5], [4, 6]] },
      { priority: 15, pairs: [[1, 2], [3, 4], [5, 6]] },
    ] as const;
    expect(MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS).toEqual(expected);
  });

  it("selects priority 1 when nothing is blocked", () => {
    const result = selectMajorSixTeamPairingPattern(SIX_IDS, []);
    expect(result.priority).toBe(1);
    expect(result.pairs).toEqual([
      { higherSeedTeamId: "a", lowerSeedTeamId: "f" },
      { higherSeedTeamId: "b", lowerSeedTeamId: "e" },
      { higherSeedTeamId: "c", lowerSeedTeamId: "d" },
    ]);
  });

  it("skips blocked priorities and picks the first legal pattern", () => {
    // block priority 1 独有边 2v5（b-e）；priority 2 = 1v6, 2v4, 3v5 不含它
    const prior = [{ teamAId: "b", teamBId: "e" }];
    const result = selectMajorSixTeamPairingPattern(SIX_IDS, prior);
    expect(result.priority).toBe(2);
    expect(result.pairs).toEqual([
      { higherSeedTeamId: "a", lowerSeedTeamId: "f" },
      { higherSeedTeamId: "b", lowerSeedTeamId: "d" },
      { higherSeedTeamId: "c", lowerSeedTeamId: "e" },
    ]);
  });

  it("throws when all 15 patterns contain a rematch", () => {
    const allEdges: { teamAId: string; teamBId: string }[] = [];
    for (let i = 1; i <= 5; i += 1) {
      for (let j = i + 1; j <= 6; j += 1) {
        allEdges.push({ teamAId: SIX_IDS[i - 1], teamBId: SIX_IDS[j - 1] });
      }
    }
    expect(() => selectMajorSixTeamPairingPattern(SIX_IDS, allEdges)).toThrow();
  });

  it("throws on wrong team count or duplicates", () => {
    expect(() => selectMajorSixTeamPairingPattern(["a", "b", "c", "d", "e"], [])).toThrow();
    expect(() => selectMajorSixTeamPairingPattern(["a", "a", "b", "c", "d", "e"], [])).toThrow();
  });

  it("covers every priority 1..15 as the first legal pattern via brute force", () => {
    const edges: [number, number][] = [];
    for (let i = 1; i <= 5; i += 1) {
      for (let j = i + 1; j <= 6; j += 1) edges.push([i, j]);
    }
    const edgeKey = (i: number, j: number) => `${i}-${j}`;

    for (let target = 1; target <= 15; target += 1) {
      let found = false;
      for (let mask = 0; mask < 1 << 15 && !found; mask += 1) {
        const blockedKeys = new Set<string>();
        for (let e = 0; e < 15; e += 1) {
          if ((mask & (1 << e)) !== 0) {
            blockedKeys.add(edgeKey(edges[e][0], edges[e][1]));
          }
        }
        // target pattern 自身不得含 blocked 边
        const targetPattern = MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS[target - 1];
        if (targetPattern.pairs.some(([i, j]) => blockedKeys.has(edgeKey(i, j)))) continue;
        // priority 1..target-1 每个至少含一条 blocked 边
        let allPriorBlocked = true;
        for (let p = 1; p < target && allPriorBlocked; p += 1) {
          const pattern = MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS[p - 1];
          allPriorBlocked = pattern.pairs.some(([i, j]) => blockedKeys.has(edgeKey(i, j)));
        }
        if (!allPriorBlocked) continue;

        const priorMatches = [...blockedKeys].map((key) => {
          const [i, j] = key.split("-").map(Number);
          return { teamAId: SIX_IDS[i - 1], teamBId: SIX_IDS[j - 1] };
        });
        const result = selectMajorSixTeamPairingPattern(SIX_IDS, priorMatches);
        expect(result.priority).toBe(target);
        found = true;
      }
      expect(found).toBe(true);
    }
  });
});

// ── 10.10 match format ──────────────────────────────────

describe("match format", () => {
  const cases: readonly (readonly [MajorSwissRecord, MajorSwissMatchFormat])[] = [
    [{ wins: 0, losses: 0 }, "bo1"],
    [{ wins: 1, losses: 0 }, "bo1"],
    [{ wins: 0, losses: 1 }, "bo1"],
    [{ wins: 1, losses: 1 }, "bo1"],
    [{ wins: 2, losses: 0 }, "bo3"],
    [{ wins: 0, losses: 2 }, "bo3"],
    [{ wins: 2, losses: 1 }, "bo3"],
    [{ wins: 1, losses: 2 }, "bo3"],
    [{ wins: 2, losses: 2 }, "bo3"],
  ];

  it.each(cases)("record %o → %s", (record, format) => {
    expect(getMajorSwissRequiredFormat(record)).toBe(format);
  });

  it("throws for terminal records", () => {
    expect(() => getMajorSwissRequiredFormat({ wins: 3, losses: 0 })).toThrow();
    expect(() => getMajorSwissRequiredFormat({ wins: 0, losses: 3 })).toThrow();
    expect(() => getMajorSwissRequiredFormat({ wins: 3, losses: 2 })).toThrow();
    expect(() => getMajorSwissRequiredFormat({ wins: 2, losses: 3 })).toThrow();
  });
});

// ── 10.11 structural counts ─────────────────────────────

describe("structural counts", () => {
  it("a complete tournament hits the exact per-round team state counts", () => {
    const { countsPerRound } = runTournament(makeRng(7));
    expect(countsPerRound).toEqual([
      { active: 16, advanced: 0, eliminated: 0 },
      { active: 16, advanced: 0, eliminated: 0 },
      { active: 12, advanced: 2, eliminated: 2 },
      { active: 6, advanced: 5, eliminated: 5 },
      { active: 0, advanced: 8, eliminated: 8 },
    ]);
  });
});

// ── 10.12 determinism ───────────────────────────────────

describe("determinism", () => {
  it("same semantic input in any array order yields identical results", () => {
    const { matches } = runTournament(makeRng(42));
    const entrants = makeEntrants();

    const baseProjection = projectMajorSwissStage({ entrants, matches, finalizedRound: 5 });
    const basePairingsR3 = generateNextMajorSwissRound({ entrants, matches, finalizedRound: 3 });
    const basePairingsR4 = generateNextMajorSwissRound({ entrants, matches, finalizedRound: 4 });

    const shuffleRng = makeRng(999);
    const shuffledEntrants = shuffle(entrants, shuffleRng);
    const shuffledMatches = shuffle(matches, shuffleRng);

    const shuffledProjection = projectMajorSwissStage({
      entrants: shuffledEntrants,
      matches: shuffledMatches,
      finalizedRound: 5,
    });
    const shuffledPairingsR3 = generateNextMajorSwissRound({
      entrants: shuffledEntrants,
      matches: shuffledMatches,
      finalizedRound: 3,
    });
    const shuffledPairingsR4 = generateNextMajorSwissRound({
      entrants: shuffledEntrants,
      matches: shuffledMatches,
      finalizedRound: 4,
    });

    expect(shuffledProjection).toEqual(baseProjection);
    expect(shuffledPairingsR3).toEqual(basePairingsR3);
    expect(shuffledPairingsR4).toEqual(basePairingsR4);
  });
});

// ── 10.13 no input mutation ─────────────────────────────

describe("no input mutation", () => {
  it("does not mutate entrants or matches", () => {
    const { matches } = runTournament(makeRng(42));
    const entrants = makeEntrants();
    const entrantsSnapshot = structuredClone(entrants);
    const matchesSnapshot = structuredClone(matches);

    const finalProjection = projectMajorSwissStage({ entrants, matches, finalizedRound: 5 });
    generateNextMajorSwissRound({ entrants, matches, finalizedRound: 3 });
    getMajorSwissRequiredFormat({ wins: 1, losses: 0 });
    selectMajorSixTeamPairingPattern(
      SIX_IDS,
      matches.map((m) => ({ teamAId: m.teamAId, teamBId: m.teamBId })),
    );
    getMajorSwissQualifiers(finalProjection);

    expect(entrants).toEqual(entrantsSnapshot);
    expect(matches).toEqual(matchesSnapshot);
  });
});

// ── 10.14 property-style tournament simulation ──────────

describe("property-style tournament simulation", () => {
  it("runs 100 deterministic tournaments without invariant failure", () => {
    let totalMatches = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      totalMatches += runTournament(makeRng(seed)).matches.length;
    }
    // 100 / 100 完成（任意 generator throw → 测试失败）；每 tournament 33 matches
    expect(totalMatches).toBe(3300);
  });
});

// ── feasibility-aware R2/R3 pairing ─────────────────────

describe("feasibility-aware R2/R3 pairing", () => {
  it("completes the naive-greedy deadlock case (r1mask=15, r2mask=24)", () => {
    // 原 naive greedy 反例：R3 1-1 group 贪心选择 1-11, 2-9, 3-10 后，
    // team-13 只剩 R1 对手 team-5 → 人工 deadlock（但该 group 存在完整
    // zero-rematch matching）。
    // feasibility-aware high-low 的差异点在 H=3：最低 non-rematch 10 不可行
    // （选中后剩余 {13,5} 互相是 R1 对手，无法配对）→ 选 5（剩余 {13,10} 可配对）
    // → 1-11, 2-9, 3-5, 13-10 完整生成。
    // 该测试用于防止 naive greedy regression。
    const entrants = makeEntrants();
    const r1 = [
      match(1, 1, "team-1", "team-9", "team-1"),
      match(1, 2, "team-2", "team-10", "team-2"),
      match(1, 3, "team-3", "team-11", "team-3"),
      match(1, 4, "team-4", "team-12", "team-4"),
      match(1, 5, "team-5", "team-13", "team-13"),
      match(1, 6, "team-6", "team-14", "team-14"),
      match(1, 7, "team-7", "team-15", "team-15"),
      match(1, 8, "team-8", "team-16", "team-16"),
    ];
    const r2Pairings = generateNextMajorSwissRound({ entrants, matches: r1, finalizedRound: 1 });
    expect(r2Pairings.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-1", "team-16"],
      ["team-2", "team-15"],
      ["team-3", "team-14"],
      ["team-4", "team-13"],
      ["team-5", "team-12"],
      ["team-6", "team-11"],
      ["team-7", "team-10"],
      ["team-8", "team-9"],
    ]);
    const r2Winners = [
      "team-16", "team-15", "team-14", "team-4",
      "team-5", "team-11", "team-10", "team-9",
    ];
    const r2 = r2Pairings.map((p, i) =>
      match(2, i + 1, p.higherSeedTeamId, p.lowerSeedTeamId, r2Winners[i]),
    );

    // generate R3 必须成功（不再 fail-closed）
    const r3 = generateNextMajorSwissRound({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });

    // full 8 R3 matches：2-0 (2) + 1-1 (4) + 0-2 (2)
    expect(r3).toHaveLength(8);
    expect(r3.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])).toEqual([
      ["team-4", "team-16"],
      ["team-14", "team-15"],
      ["team-1", "team-11"],
      ["team-2", "team-9"],
      ["team-3", "team-5"],
      ["team-13", "team-10"],
      ["team-6", "team-12"],
      ["team-7", "team-8"],
    ]);

    // 1-1 group full 4 matches
    expect(r3.filter((p) => p.record.wins === 1 && p.record.losses === 1)).toHaveLength(4);

    // exact same record / no cross-record / zero rematch
    const projection = projectMajorSwissStage({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });
    const byId = new Map(projection.teams.map((t) => [t.teamId, t]));
    for (const pairing of r3) {
      const higher = byId.get(pairing.higherSeedTeamId)!;
      const lower = byId.get(pairing.lowerSeedTeamId)!;
      expect(higher.wins).toBe(pairing.record.wins);
      expect(higher.losses).toBe(pairing.record.losses);
      expect(lower.wins).toBe(pairing.record.wins);
      expect(lower.losses).toBe(pairing.record.losses);
      expect(higher.opponents).not.toContain(pairing.lowerSeedTeamId);
      expect(lower.opponents).not.toContain(pairing.higherSeedTeamId);
    }

    // correct BO format：2-0 / 0-2 → bo3，1-1 → bo1
    expect(r3.slice(0, 2).every((p) => p.format === "bo3")).toBe(true);
    expect(r3.slice(2, 6).every((p) => p.format === "bo1")).toBe(true);
    expect(r3.slice(6, 8).every((p) => p.format === "bo3")).toBe(true);

    // deterministic
    const again = generateNextMajorSwissRound({ entrants, matches: [...r1, ...r2], finalizedRound: 2 });
    expect(again).toEqual(r3);
  });
});

// ── exhaustive R1/R2 feasibility regression ─────────────

interface OracleTeam {
  wins: number;
  losses: number;
  opponents: string[];
}

// 轻量独立 oracle：直接从 match facts 计算 record 与对手，
// 不依赖被测实现（用于 65536 枚举中的 per-combination 校验）
function computeOracle(
  entrants: readonly MajorSwissEntrant[],
  r1: readonly MajorSwissMatchFact[],
  r2: readonly MajorSwissMatchFact[],
): Map<string, OracleTeam> {
  const byId = new Map<string, OracleTeam>();
  for (const entrant of entrants) {
    byId.set(entrant.teamId, { wins: 0, losses: 0, opponents: [] });
  }
  for (const fact of [...r1, ...r2]) {
    const winner = byId.get(fact.winnerId)!;
    const loserId = fact.winnerId === fact.teamAId ? fact.teamBId : fact.teamAId;
    const loser = byId.get(loserId)!;
    winner.wins += 1;
    loser.losses += 1;
    winner.opponents.push(loserId);
    loser.opponents.push(fact.winnerId);
  }
  return byId;
}

describe("exhaustive R1/R2 feasibility", () => {
  it(
    "generates a complete zero-rematch R3 for all 65536 legal R1/R2 outcomes",
    () => {
      const entrants = makeEntrants();
      let checked = 0;
      for (let r1mask = 0; r1mask < 256; r1mask += 1) {
        const r1: MajorSwissMatchFact[] = [];
        for (let i = 0; i < 8; i += 1) {
          const high = `team-${i + 1}`;
          const low = `team-${i + 9}`;
          const winner = (r1mask & (1 << i)) !== 0 ? high : low;
          r1.push(match(1, i + 1, high, low, winner));
        }

        // R2 pairing 必须由 generator 自己生成
        const r2Pairings = generateNextMajorSwissRound({ entrants, matches: r1, finalizedRound: 1 });

        for (let r2mask = 0; r2mask < 256; r2mask += 1) {
          const r2 = r2Pairings.map((p, i) =>
            match(
              2,
              i + 1,
              p.higherSeedTeamId,
              p.lowerSeedTeamId,
              (r2mask & (1 << i)) !== 0 ? p.higherSeedTeamId : p.lowerSeedTeamId,
            ),
          );

          // 不得因为 naive pairing choice 而失败（失败时 throw 带定位信息）
          const r3 = generateNextMajorSwissRound({
            entrants,
            matches: [...r1, ...r2],
            finalizedRound: 2,
          });
          if (r3.length !== 8) {
            throw new Error(`r1mask=${r1mask} r2mask=${r2mask}: expected 8 R3 matches, got ${r3.length}`);
          }

          // 轻量 invariant accumulator（不在 inner loop 中调用 Vitest expect，
          // 避免 coverage instrumentation 下的 assertion 开销）
          const oracle = computeOracle(entrants, r1, r2);
          const participants = new Set<string>();
          for (const pairing of r3) {
            const higher = oracle.get(pairing.higherSeedTeamId)!;
            const lower = oracle.get(pairing.lowerSeedTeamId)!;
            const sameRecord =
              higher.wins === pairing.record.wins &&
              higher.losses === pairing.record.losses &&
              lower.wins === pairing.record.wins &&
              lower.losses === pairing.record.losses;
            if (!sameRecord) {
              throw new Error(
                `r1mask=${r1mask} r2mask=${r2mask}: cross-record pairing ` +
                  `${pairing.higherSeedTeamId}-${pairing.lowerSeedTeamId} ` +
                  `(oracle ${higher.wins}-${higher.losses} vs ${lower.wins}-${lower.losses})`,
              );
            }
            if (
              higher.opponents.includes(pairing.lowerSeedTeamId) ||
              lower.opponents.includes(pairing.higherSeedTeamId)
            ) {
              throw new Error(
                `r1mask=${r1mask} r2mask=${r2mask}: rematch pairing ` +
                  `${pairing.higherSeedTeamId}-${pairing.lowerSeedTeamId}`,
              );
            }
            participants.add(pairing.higherSeedTeamId);
            participants.add(pairing.lowerSeedTeamId);
          }
          if (participants.size !== 16) {
            throw new Error(
              `r1mask=${r1mask} r2mask=${r2mask}: expected 16 participants, got ${participants.size}`,
            );
          }
          checked += 1;
        }
      }
      // 65536 / 65536 完整执行
      expect(checked).toBe(65536);
    },
    120_000,
  );
});

// ── 10.15 no teamA/teamB semantics ──────────────────────

describe("pairing field semantics", () => {
  it("pairings expose higher/lower seed ids, never teamA/teamB", () => {
    // 编译期：MajorSwissPairing 不得存在 teamAId / teamBId 语义字段
    const typeGuard: MajorSwissPairing extends { teamAId: string } ? never : true = true;
    expect(typeGuard).toBe(true);

    const pairings = generateNextMajorSwissRound({
      entrants: makeEntrants(),
      matches: [],
      finalizedRound: 0,
    });
    for (const pairing of pairings) {
      expect(pairing).not.toHaveProperty("teamAId");
      expect(pairing).not.toHaveProperty("teamBId");
      expect(pairing.higherSeedTeamId).toBeDefined();
      expect(pairing.lowerSeedTeamId).toBeDefined();
    }
  });
});
