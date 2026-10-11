import { describe, expect, it } from "vitest";
import type { Match, MatchMap } from "@/db/schema";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import type { DemoImportMetadata } from "@/lib/demo-integration/metadata";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import { projectOperatorMaps } from "./operator-maps";

const match = { id: "match", seasonId: "season", stage: "play-in", majorStageRunId: null,
  entryAId: "entry-a", entryBId: "entry-b", status: "finished" } as Match;
const map = { id: "map", matchId: match.id, mapOrder: 1, mapName: "de_inferno",
  scoreA: 13, scoreB: 6, completedAt: new Date("2026-10-10T13:52:22.844Z"), teamAStartSide: "ct" } as MatchMap;
const starters = Array.from({ length: 10 }, (_, i) => ({ matchId: match.id,
  entryId: i < 5 ? "entry-a" : "entry-b", rosterId: `roster-${i < 5 ? "a" : "b"}`,
  eventRosterMemberId: `member-${i}`, userId: `player-${i}`, steam64: `7656119800000000${i}`,
  displayName: null, personaName: null, perfectName: `player-${i}`, isStarter: true })) satisfies EffectiveMatchRosterPlayer[];
const reserves = [0, 1].map(i => ({ ...starters[i * 5], eventRosterMemberId: `reserve-${i}`,
  userId: `reserve-${i}`, isStarter: false }));
const scoreboards = starters.map(player => ({ matchId: match.id, mapId: map.id,
  userId: player.userId, perfectName: player.perfectName, kills: 10, deaths: 10, assists: 0,
  hsPercent: 0, firstKills: 0, multiKills: 0, clutches: 0, adr: 50, ratingPro: 1, rws: 0, we: 0 }));
const imports = [{ matchMapId: map.id, status: "confirmed", semanticProfile: CURRENT_DAK_SEMANTIC_PROFILE,
  evidenceRevision: buildEvidenceRevisionForTarget({ match, map, roster: starters }) }] as DemoImportMetadata[];
const project = (roster: EffectiveMatchRosterPlayer[], target = map) => projectOperatorMaps({
  match, maps: [target], imports, roster, scoreboards,
})[0];

describe("operator Demo completion against the actual lineup", () => {
  it("keeps a ten-player confirmed Demo synced when the overview includes two reserves", () => {
    const roster = [...starters, ...reserves];
    expect(project(roster)).toEqual(project(starters));
    expect(project(roster)).toMatchObject({ scoreboardComplete: true, demoComplete: true, demoLabel: "已同步" });
    expect(roster).toHaveLength(12);
    expect(roster.filter(player => !player.isStarter)).toEqual(reserves);
  });

  it("still requires review when a reserve replaces a starter or the official score changes", () => {
    const changedLineup = [...starters.map((player, i) => i === 0 ? { ...player, isStarter: false } : player),
      { ...reserves[0], isStarter: true }, reserves[1]];
    expect(project(changedLineup)).toMatchObject({ demoComplete: false, demoNeedsAttention: true });
    expect(project([...starters, ...reserves], { ...map, scoreB: 7 })).toMatchObject({
      demoComplete: false, demoNeedsAttention: true,
    });
  });
});
