import { describe, expect, it } from "vitest";
import { seedMajorLaterStageEntrants, seedMajorStageOneEntrants } from "./seeding";
import type { MajorAdvancingTeam, MajorTournamentSeededTeam } from "./seeding";

// deterministic shuffle（避免 Math.random）
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

const STAGE_ONE_TEAMS: MajorTournamentSeededTeam[] = Array.from({ length: 16 }, (_, i) => ({
  teamId: `team-${i + 1}`,
  tournamentSeed: 17 + i,
}));

describe("seedMajorStageOneEntrants", () => {
  it("normalizes tournament seeds 17..32 to stage seeds 1..16", () => {
    const entrants = seedMajorStageOneEntrants(STAGE_ONE_TEAMS);
    expect(entrants).toHaveLength(16);
    expect(entrants.map((e) => e.initialStageSeed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    entrants.forEach((entrant, i) => {
      expect(entrant.teamId).toBe(`team-${i + 1}`);
    });
  });

  it("is independent of input order", () => {
    const shuffled = shuffle(STAGE_ONE_TEAMS, makeRng(11));
    expect(shuffled[0].teamId).not.toBe("team-1"); // 确认确实乱序了
    const entrants = seedMajorStageOneEntrants(shuffled);
    expect(entrants.map((e) => e.teamId)).toEqual(
      Array.from({ length: 16 }, (_, i) => `team-${i + 1}`),
    );
    expect(entrants.map((e) => e.initialStageSeed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("normalizes arbitrary non-contiguous positive tournament seeds by relative order", () => {
    const irregular: MajorTournamentSeededTeam[] = [
      { teamId: "team-a", tournamentSeed: 101 },
      { teamId: "team-b", tournamentSeed: 3 },
      { teamId: "team-c", tournamentSeed: 2000 },
      { teamId: "team-d", tournamentSeed: 7 },
      { teamId: "team-e", tournamentSeed: 42 },
      { teamId: "team-f", tournamentSeed: 1 },
      { teamId: "team-g", tournamentSeed: 500 },
      { teamId: "team-h", tournamentSeed: 88 },
      { teamId: "team-i", tournamentSeed: 12 },
      { teamId: "team-j", tournamentSeed: 999 },
      { teamId: "team-k", tournamentSeed: 5 },
      { teamId: "team-l", tournamentSeed: 300 },
      { teamId: "team-m", tournamentSeed: 64 },
      { teamId: "team-n", tournamentSeed: 2 },
      { teamId: "team-o", tournamentSeed: 77 },
      { teamId: "team-p", tournamentSeed: 10 },
    ];
    const entrants = seedMajorStageOneEntrants(irregular);
    expect(entrants.map((e) => e.teamId)).toEqual([
      "team-f", "team-n", "team-b", "team-k", "team-d", "team-p", "team-i", "team-e",
      "team-m", "team-o", "team-h", "team-a", "team-l", "team-g", "team-j", "team-c",
    ]);
    expect(entrants.map((e) => e.initialStageSeed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("throws when not exactly 16 teams", () => {
    expect(() => seedMajorStageOneEntrants(STAGE_ONE_TEAMS.slice(0, 15))).toThrow();
    expect(() => seedMajorStageOneEntrants([...STAGE_ONE_TEAMS, { teamId: "team-17", tournamentSeed: 33 }])).toThrow();
  });

  it("throws on duplicate teamId", () => {
    const dup = [...STAGE_ONE_TEAMS];
    dup[15] = { ...dup[15], teamId: "team-1" };
    expect(() => seedMajorStageOneEntrants(dup)).toThrow();
  });

  it("throws on empty teamId", () => {
    const bad = [...STAGE_ONE_TEAMS];
    bad[0] = { ...bad[0], teamId: "" };
    expect(() => seedMajorStageOneEntrants(bad)).toThrow();
  });

  it("throws on duplicate tournamentSeed", () => {
    const dup = [...STAGE_ONE_TEAMS];
    dup[15] = { ...dup[15], tournamentSeed: 17 };
    expect(() => seedMajorStageOneEntrants(dup)).toThrow();
  });

  it("throws on invalid tournamentSeed", () => {
    const zero = [...STAGE_ONE_TEAMS];
    zero[0] = { ...zero[0], tournamentSeed: 0 };
    expect(() => seedMajorStageOneEntrants(zero)).toThrow();

    const negative = [...STAGE_ONE_TEAMS];
    negative[0] = { ...negative[0], tournamentSeed: -5 };
    expect(() => seedMajorStageOneEntrants(negative)).toThrow();

    const fractional = [...STAGE_ONE_TEAMS];
    fractional[0] = { ...fractional[0], tournamentSeed: 2.5 };
    expect(() => seedMajorStageOneEntrants(fractional)).toThrow();
  });

  it("does not mutate its input", () => {
    const snapshot = structuredClone(STAGE_ONE_TEAMS);
    seedMajorStageOneEntrants(shuffle(STAGE_ONE_TEAMS, makeRng(3)));
    expect(STAGE_ONE_TEAMS).toEqual(snapshot);
  });
});

const DIRECT: MajorTournamentSeededTeam[] = Array.from({ length: 8 }, (_, i) => ({
  teamId: `direct-${i + 1}`,
  tournamentSeed: 33 + i,
}));

const ADVANCING: MajorAdvancingTeam[] = Array.from({ length: 8 }, (_, i) => ({
  teamId: `advance-${i + 1}`,
  previousStageFinalSeed: i + 1,
}));

describe("seedMajorLaterStageEntrants", () => {
  it("assigns direct entrants seeds 1..8 and advancing entrants seeds 9..16", () => {
    const entrants = seedMajorLaterStageEntrants({
      directEntrants: DIRECT,
      advancingEntrants: ADVANCING,
    });
    expect(entrants).toHaveLength(16);
    expect(entrants.map((e) => e.initialStageSeed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    entrants.slice(0, 8).forEach((entrant, i) => {
      expect(entrant.teamId).toBe(`direct-${i + 1}`);
    });
    entrants.slice(8).forEach((entrant, i) => {
      expect(entrant.teamId).toBe(`advance-${i + 1}`);
    });
  });

  it("is independent of input order in both groups", () => {
    const reversedDirect = [...DIRECT].reverse();
    const reversedAdvancing = [...ADVANCING].reverse();
    const entrants = seedMajorLaterStageEntrants({
      directEntrants: reversedDirect,
      advancingEntrants: reversedAdvancing,
    });
    // 输入逆序不改变结果：仍按 tournamentSeed / previousStageFinalSeed ASC
    expect(entrants.map((e) => e.initialStageSeed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    expect(entrants.map((e) => e.teamId)).toEqual([
      "direct-1", "direct-2", "direct-3", "direct-4",
      "direct-5", "direct-6", "direct-7", "direct-8",
      "advance-1", "advance-2", "advance-3", "advance-4",
      "advance-5", "advance-6", "advance-7", "advance-8",
    ]);
  });

  it("throws when direct group is not exactly 8", () => {
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: DIRECT.slice(0, 7), advancingEntrants: ADVANCING }),
    ).toThrow();
    expect(() =>
      seedMajorLaterStageEntrants({
        directEntrants: [...DIRECT, { teamId: "direct-9", tournamentSeed: 41 }],
        advancingEntrants: ADVANCING,
      }),
    ).toThrow();
  });

  it("throws when advancing group is not exactly 8", () => {
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: DIRECT, advancingEntrants: ADVANCING.slice(0, 7) }),
    ).toThrow();
    expect(() =>
      seedMajorLaterStageEntrants({
        directEntrants: DIRECT,
        advancingEntrants: [...ADVANCING, { teamId: "advance-9", previousStageFinalSeed: 9 }],
      }),
    ).toThrow();
  });

  it("throws on duplicate teamId across groups", () => {
    const dupAdvancing = [...ADVANCING];
    dupAdvancing[0] = { ...dupAdvancing[0], teamId: "direct-1" };
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: DIRECT, advancingEntrants: dupAdvancing }),
    ).toThrow();
  });

  it("throws on duplicate teamId within advancing group", () => {
    const dupAdvancing = [...ADVANCING];
    dupAdvancing[7] = { ...dupAdvancing[7], teamId: "advance-1" };
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: DIRECT, advancingEntrants: dupAdvancing }),
    ).toThrow();
  });

  it("throws on duplicate tournamentSeed in direct group", () => {
    const dupDirect = [...DIRECT];
    dupDirect[7] = { ...dupDirect[7], tournamentSeed: 33 };
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: dupDirect, advancingEntrants: ADVANCING }),
    ).toThrow();
  });

  it("throws on invalid tournamentSeed", () => {
    const badDirect = [...DIRECT];
    badDirect[0] = { ...badDirect[0], tournamentSeed: 0 };
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: badDirect, advancingEntrants: ADVANCING }),
    ).toThrow();

    const fractionalDirect = [...DIRECT];
    fractionalDirect[0] = { ...fractionalDirect[0], tournamentSeed: 1.5 };
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: fractionalDirect, advancingEntrants: ADVANCING }),
    ).toThrow();
  });

  it("throws on duplicate previousStageFinalSeed", () => {
    const dupAdvancing = [...ADVANCING];
    dupAdvancing[7] = { ...dupAdvancing[7], previousStageFinalSeed: 1 };
    expect(() =>
      seedMajorLaterStageEntrants({ directEntrants: DIRECT, advancingEntrants: dupAdvancing }),
    ).toThrow();
  });

  it("throws on previousStageFinalSeed outside 1..8", () => {
    for (const badSeed of [0, 9, 1.5, -1]) {
      const badAdvancing = [...ADVANCING];
      badAdvancing[0] = { ...badAdvancing[0], previousStageFinalSeed: badSeed };
      expect(() =>
        seedMajorLaterStageEntrants({ directEntrants: DIRECT, advancingEntrants: badAdvancing }),
      ).toThrow();
    }
  });

  it("does not mutate its inputs", () => {
    const directSnapshot = structuredClone(DIRECT);
    const advancingSnapshot = structuredClone(ADVANCING);
    seedMajorLaterStageEntrants({
      directEntrants: shuffle(DIRECT, makeRng(5)),
      advancingEntrants: shuffle(ADVANCING, makeRng(6)),
    });
    expect(DIRECT).toEqual(directSnapshot);
    expect(ADVANCING).toEqual(advancingSnapshot);
  });
});
