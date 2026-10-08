import { describe, expect, it } from "vitest";
import {
  simulateContext,
  replaceContextChoice,
} from "@/lib/predictions/context-simulator";
import {
  generateShortSwissRoundPairings,
  projectShortSwissStage,
} from "@/lib/competition-qualification/swiss";
import {
  SIMULATION_VERSION,
  type Choices,
  type QualificationShortSwissContext,
} from "@/lib/predictions/types";
import type { SwissCompletedMatch } from "@/lib/swiss/types";
import { pickEmDockVisible } from "@/lib/predictions/presentation";

function context(): QualificationShortSwissContext {
  const entrants = Array.from({ length: 12 }, (_, i) => ({
    teamId: `t${i + 1}`,
    initialSeed: i + 1,
  }));
  return {
    kind: "qualification-short-swiss",
    runId: "qualification",
    entrants,
    baseline: {
      version: SIMULATION_VERSION,
      seasonId: "s",
      name: "Play-in",
      capturedAt: "2026-10-06T00:00:00Z",
      stages: [
        {
          key: "play-in",
          name: "Play-in",
          type: "swiss",
          matchFormat: "bo1",
          entrySeeds: 12,
          finalFormat: null,
          previousKey: null,
          nextKey: null,
          directSeeds: [1, 12],
        },
      ],
      teams: entrants.map((e) => ({
        teamId: e.teamId,
        name: e.teamId,
        logoUrl: null,
        tournamentSeed: e.initialSeed + 18,
      })),
      matches: [],
      runs: [],
    },
  };
}

function assertCanonical(c: QualificationShortSwissContext, choices: Choices) {
  const stage = simulateContext(c, choices)[0]!;
  const facts: SwissCompletedMatch[] = [];
  for (let round = 1; round <= 3; round++) {
    const expected = generateShortSwissRoundPairings({
      entrants: c.entrants,
      matches: facts,
      completedRound: round - 1,
    });
    const rows = stage.matches.filter((m) => m.round === round);
    expect(rows.map((m) => [m.a, m.b])).toEqual(
      expected.map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId]),
    );
    facts.push(
      ...rows.map((m) => ({
        matchId: m.key,
        round,
        entryAId: m.a,
        entryBId: m.b,
        winnerId: m.winner!,
      })),
    );
  }
  const projection = projectShortSwissStage({
    entrants: c.entrants,
    matches: facts,
    completedRound: 3,
  });
  expect(stage.standings).toEqual(
    projection.teams.map((t) => ({
      teamId: t.teamId,
      wins: t.wins,
      losses: t.losses,
    })),
  );
  expect(stage.pick).toBeNull();
  expect(projection.advanced).toHaveLength(6);
  expect(projection.eliminated).toHaveLength(6);
  expect(stage.matches).toHaveLength(15);
  return stage;
}

describe("local Qualification worldlines", () => {
  it("uses canonical 2W2L / three rounds without creating a Main Event", () => {
    const c = context();
    const stage = assertCanonical(c, {});
    expect(simulateContext(c, {})).toHaveLength(1);
    expect(stage.swissPolicy).toEqual({ winThreshold: 2, lossThreshold: 2 });
    expect(
      stage.matches.every((m) => m.winner === m.a && m.source === "preview"),
    ).toBe(true);
    expect(c.baseline.runs).toEqual([]);
  });
  it("clears downstream assumptions when either R1 or R2 changes and recomputes high-seed defaults", () => {
    for (const round of [1, 2]) {
      const c = context();
      const rows = simulateContext(c, {})[0]!.matches;
      const choices: Choices = Object.fromEntries(
        rows.map((m) => [`play-in/${m.key}`, { a: m.a, b: m.b, winner: m.a }]),
      );
      const changed = rows.find((m) => m.round === round)!;
      const next = replaceContextChoice(
        c,
        choices,
        "play-in",
        changed,
        changed.b,
      );
      const stage = assertCanonical(c, next);
      expect(
        Object.keys(next).every(
          (key) => rows.find((m) => key === `play-in/${m.key}`)!.round <= round,
        ),
      ).toBe(true);
      expect(
        stage.matches
          .filter((m) => m.round > round)
          .every((m) => m.winner === m.a && m.source === "preview"),
      ).toBe(true);
    }
  });
  it("starts from official scores, permits an if line, and never mutates the baseline", () => {
    const c = context();
    const first = simulateContext(c, {})[0]!.matches[0]!;
    c.baseline.matches.push({
      id: "m",
      stageKey: "play-in",
      key: "official",
      round: 1,
      a: first.a,
      b: first.b,
      winner: first.b,
      scoreA: 9,
      scoreB: 13,
      format: "bo1",
      status: "finished",
      scheduledAt: null,
    });
    const original = structuredClone(c);
    expect(simulateContext(c, {})[0]!.matches[0]).toMatchObject({
      officialMatchId: "m",
      winner: first.b,
      source: "official",
      scoreA: 9,
      scoreB: 13,
    });
    const next = replaceContextChoice(c, {}, "play-in", first, first.a);
    expect(simulateContext(c, next)[0]!.matches[0]).toMatchObject({
      officialMatchId: "m",
      winner: first.a,
      source: "assumption",
      scoreA: null,
      scoreB: null,
    });
    expect(c).toEqual(original);
    expect(simulateContext(c, {})[0]!.matches[0]!.winner).toBe(first.b);
    expect(simulateContext(c, next)[0]!.matches.filter(m => m.round > 1).every(m => !m.officialMatchId)).toBe(true);
  });
});

describe("Main Event submission dock", () => {
  const open = { locked: false, voidReason: null, submitted: null };
  it("shows open Main Event contests and hides every Play-in dock", () => {
    expect(pickEmDockVisible("major", open)).toBe(true);
    expect(pickEmDockVisible("major")).toBe(false);
    expect(
      pickEmDockVisible("qualification-short-swiss", {
        ...open,
        submitted: {},
      }),
    ).toBe(false);
  });
  it("hides closed or voided contests without a submission and retains submitted records", () => {
    for (const window of [
      { ...open, locked: true },
      { ...open, voidReason: "作废原因" },
    ]) {
      expect(pickEmDockVisible("major", window)).toBe(false);
      expect(pickEmDockVisible("major", { ...window, submitted: {} })).toBe(
        true,
      );
    }
  });
});
