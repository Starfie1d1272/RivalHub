import { expect, it } from "vitest";
import { defaultLineupPlayer, lineupComparisonCutoff, resolveLineup, type LineupCareer, type LineupPlayer } from "./lineup-comparison";

const player = (userId: string): LineupPlayer => ({ userId, displayName: userId, personaName: null, perfectName: null, avatarUrl: null, isStarter: true });
const career = (userId: string, maps: number, rating: number | null, qualified: boolean): LineupCareer => ({ userId, maps, rounds: maps * 24, rating, qualified, adr: null, kpr: null, kast: null, firstKill: null, trade: null });

it("chooses eligible Rating before experience and excludes bench players", () => {
  const players = [player("experienced"), player("limited"), player("star"), { ...player("bench"), isStarter: false }];
  expect(defaultLineupPlayer(players, [career("experienced", 20, 1.1, true), career("limited", 1, 2, false), career("star", 10, 1.3, true), career("bench", 30, 3, true)])).toBe("star");
  expect(defaultLineupPlayer(players, [career("experienced", 3, 1, false), career("limited", 1, 2, false)])).toBe("experienced");
  expect(defaultLineupPlayer([], [])).toBeNull();
});

it("resolves each side independently and never replaces a saved historical lineup", () => {
  const registered = [{ ...player("new"), isPrimaryStarter: true }, { ...player("sub"), isPrimaryStarter: false }];
  expect(resolveLineup(null, registered, true)).toMatchObject({ expected: true, players: [{ userId: "new", isStarter: true }] });
  expect(resolveLineup([player("old"), player("sub")], registered, false)).toMatchObject({ expected: false, players: [{ userId: "old", substituteAppearance: false }, { userId: "sub", substituteAppearance: true }] });
  expect(resolveLineup(null, registered, false)).toEqual({ players: null, expected: false });
  expect(resolveLineup([], registered, true)).toEqual({ players: [], expected: false });
});

it("fixes the cutoff at the start, falling back to an elapsed schedule only", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const start = new Date("2026-10-18T12:00:00Z");
  expect(lineupComparisonCutoff({ startedAt: start, gameplayStartedAt: now, scheduledAt: null }, now)).toBe(start);
  expect(lineupComparisonCutoff({ startedAt: null, gameplayStartedAt: null, scheduledAt: new Date("2026-10-20T00:00:00Z") }, now)).toBeNull();
  expect(lineupComparisonCutoff({ startedAt: null, gameplayStartedAt: null, scheduledAt: start }, now)).toBe(start);
});
