import { describe, expect, it } from "vitest";
import {
  buildTournamentPerformanceAnalytics,
  buildTournamentPerformanceAnalyticsFromProjections,
  collectTournamentPerformanceMapProjection,
  remapTournamentPerformanceMapProjection,
  scopeTournamentPerformanceMapProjectionToTeam,
  type TournamentPerformanceMapFacts,
  type TournamentPerformanceMapProjection,
} from "@cs2dak/tournament";
import normal from "../../../tests/fixtures/demo-evidence/normal-map-v1.json";
import overtime from "../../../tests/fixtures/demo-evidence/overtime-map-v1.json";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";

function facts(input: unknown, key: string): TournamentPerformanceMapFacts {
  const evidence = parseRivalHubDemoEvidenceV1(input);
  const bindings = new Map(evidence.participants.map((row, index) => [row.steamId64, {
    userId: `player-${index}`,
    entryId: row.observedTeamKey === "teamA" ? evidence.target.entryAId : evidence.target.entryBId,
  }]));
  const value = adaptStatsEvidence(evidence, bindings).performance;
  return { ...value, mapKey: key };
}

function persisted(value: TournamentPerformanceMapProjection): TournamentPerformanceMapProjection {
  return JSON.parse(JSON.stringify(value)) as TournamentPerformanceMapProjection;
}

/** Map-level summation can reorder floating additions; integral facts remain exact. */
function expectEquivalent(actual: unknown, expected: unknown): void {
  if (typeof expected === "number") {
    if (Number.isInteger(expected)) expect(actual).toBe(expected);
    else {
      expect(typeof actual).toBe("number");
      expect(Math.abs((actual as number) - expected)).toBeLessThan(1e-9);
    }
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((value, index) => expectEquivalent((actual as unknown[])[index], value));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual).not.toBeNull();
    expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
    for (const [key, value] of Object.entries(expected)) expectEquivalent((actual as Record<string, unknown>)[key], value);
    return;
  }
  expect(actual).toBe(expected);
}

function remapFacts(value: TournamentPerformanceMapFacts, ownTeam: string): TournamentPerformanceMapFacts {
  const remapTeam = (key: string) => key === ownTeam ? "long-team" : key;
  const remapPlayer = (key: string, team: string) => team === ownTeam ? key : `opponent:${team}:${key}`;
  return {
    ...value,
    teamEntityKeys: { teamA: remapTeam(value.teamEntityKeys.teamA), teamB: remapTeam(value.teamEntityKeys.teamB) },
    playerRounds: value.playerRounds.map((row) => ({ ...row, teamEntityKey: remapTeam(row.teamEntityKey), playerEntityKey: remapPlayer(row.playerEntityKey, row.teamEntityKey) })),
    playerWeapons: value.playerWeapons.map((row) => ({ ...row, teamEntityKey: remapTeam(row.teamEntityKey), playerEntityKey: remapPlayer(row.playerEntityKey, row.teamEntityKey) })),
    objectives: value.objectives.map((row) => ({ ...row, teamEntityKey: row.teamEntityKey ? remapTeam(row.teamEntityKey) : null, playerEntityKey: row.playerEntityKey && row.teamEntityKey ? remapPlayer(row.playerEntityKey, row.teamEntityKey) : row.playerEntityKey })),
  };
}

describe("DAK persistent performance accumulators", () => {
  it("preserves every field through JSON persistence, map/side aggregation, and match deduplication", () => {
    const first = facts(normal, "first-map");
    const second = { ...facts(overtime, "second-map"), matchKey: first.matchKey };
    const third = { ...facts(normal, "third-map"), matchKey: "second-match", mapName: "de_anubis" };
    const rows = [third, second, first];
    const labels = { players: { "player-0": "Player Zero" } };
    const projected = rows.map((row) => persisted(collectTournamentPerformanceMapProjection(row)));
    const original = JSON.stringify(projected);
    const actual = buildTournamentPerformanceAnalyticsFromProjections(projected, { labels });
    expectEquivalent(actual, buildTournamentPerformanceAnalytics(rows, { labels }));
    expect(actual.totals.matchCount).toBe(2);
    expect(actual.totals.mapCount).toBe(3);
    expect(actual.players[0]!.slices.t.sample.rounds + actual.players[0]!.slices.ct.sample.rounds).toBe(actual.players[0]!.slices.overall.sample.rounds);
    expect(JSON.stringify(projected)).toBe(original);
    expect(JSON.stringify(projected)).not.toContain("playerRounds");
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(Buffer.byteLength(JSON.stringify(rows)) * 0.25);
  });

  it("preserves null denominators, unassigned objectives, and empty-map participation", () => {
    const value = { ...facts(normal, "empty-map"), playerRounds: [], playerWeapons: [], objectives: [] };
    expect(buildTournamentPerformanceAnalyticsFromProjections([persisted(collectTournamentPerformanceMapProjection(value))]))
      .toEqual(buildTournamentPerformanceAnalytics([value]));
    expect(buildTournamentPerformanceAnalyticsFromProjections([])).toEqual(buildTournamentPerformanceAnalytics([]));
    const unassigned = facts(normal, "unassigned-map");
    unassigned.objectives.push({ roundSeq: 900, type: "planted", playerEntityKey: null, teamEntityKey: null, side: null, teamWonRound: null });
    expect(buildTournamentPerformanceAnalyticsFromProjections([persisted(collectTournamentPerformanceMapProjection(unassigned))]))
      .toEqual(buildTournamentPerformanceAnalytics([unassigned]));
  });

  it("isolates transferred opponent contributions and remaps weapon ownership without changing formulas", () => {
    const first = facts(normal, "before-transfer");
    const second = facts(overtime, "after-transfer");
    // The same identity represents the other side in a later map.
    const ownTeam = first.teamEntityKeys.teamA;
    const otherTeam = second.teamEntityKeys.teamB;
    const firstOwnPlayer = first.playerRounds.find((row) => row.teamEntityKey === ownTeam)!.playerEntityKey;
    const opponentPlayer = second.playerRounds.find((row) => row.teamEntityKey === otherTeam)!.playerEntityKey;
    const rename = (key: string) => key === firstOwnPlayer ? opponentPlayer : key === opponentPlayer ? firstOwnPlayer : key;
    second.playerRounds = second.playerRounds.map((row) => ({ ...row, playerEntityKey: rename(row.playerEntityKey) }));
    second.playerWeapons = second.playerWeapons.map((row) => ({ ...row, playerEntityKey: rename(row.playerEntityKey) }));
    second.objectives = second.objectives.map((row) => ({ ...row, playerEntityKey: row.playerEntityKey ? rename(row.playerEntityKey) : null }));
    const rows = [first, second];
    const projected = rows.map((row) => remapTournamentPerformanceMapProjection(persisted(collectTournamentPerformanceMapProjection(row)), {
      teamEntityKey: (key) => key === ownTeam ? "long-team" : key,
      playerEntityKey: (key, team) => team === ownTeam ? key : `opponent:${team}:${key}`,
    }));
    expectEquivalent(buildTournamentPerformanceAnalyticsFromProjections(projected),
      buildTournamentPerformanceAnalytics(rows.map((row) => remapFacts(row, ownTeam))));
  });

  it("scopes only team contributions after validating complete opening duels", () => {
    const value = facts(normal, "scoped-map");
    const ownTeam = value.teamEntityKeys.teamA;
    const before = persisted(collectTournamentPerformanceMapProjection(value));
    const result = buildTournamentPerformanceAnalyticsFromProjections([scopeTournamentPerformanceMapProjectionToTeam(before, ownTeam)]);
    const original = buildTournamentPerformanceAnalytics([value]);
    expect(result.players).toEqual(original.players.filter((row) => row.teamEntityKeys.includes(ownTeam)));
    expect(result.teams.find((row) => row.team.entityKey === ownTeam)).toEqual(original.teams.find((row) => row.team.entityKey === ownTeam));
    expect(result.teams.find((row) => row.team.entityKey !== ownTeam)?.roundCount).toBe(0);
    expect(result.totals.utility).toEqual(original.teams.find((row) => row.team.entityKey === ownTeam)!.slices.overall.utility);
    expect(result.totals.opening.roundsWithOpening).toBeLessThanOrEqual(result.totals.roundCount);
    expect(buildTournamentPerformanceAnalyticsFromProjections([before])).toEqual(original);
  });

  it("rejects duplicate maps, mixed semantic versions, unsupported formats, and identity collapse", () => {
    const row = collectTournamentPerformanceMapProjection(facts(normal, "validated-map"));
    expect(() => buildTournamentPerformanceAnalyticsFromProjections([row, row])).toThrow("duplicate mapKey");
    const mixed = collectTournamentPerformanceMapProjection({ ...facts(normal, "another-map"), semanticProfile: "different" });
    expect(() => buildTournamentPerformanceAnalyticsFromProjections([row, mixed])).toThrow("mixed semantic profile");
    expect(() => buildTournamentPerformanceAnalyticsFromProjections([{ ...row, version: 99 } as unknown as TournamentPerformanceMapProjection])).toThrow("unsupported version");
    expect(() => remapTournamentPerformanceMapProjection(row, { teamEntityKey: () => "same", playerEntityKey: (key) => key })).toThrow("distinct");
    expect(() => scopeTournamentPerformanceMapProjectionToTeam(row, "unrelated-team")).toThrow("does not belong");
  });
});
