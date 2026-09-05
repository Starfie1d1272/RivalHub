import { describe, expect, it } from "vitest";
import type { CompetitiveProfileConfig } from "@/types/season";
import {
  analyzeFinalSeedOrder,
  buildFrozenSetFingerprint,
  buildSeedRecommendationSnapshotPayload,
  buildTeamSeedRecommendations,
  getSeedRecommendationSnapshotStatus,
} from "./team-seed-recommendation";
import type { PlayerStrengthInput } from "./player-strength";

const config = {
  platform: "perfect-world",
  currentSeasonKey: "current",
  previousSeasonKey: "previous",
  rankOrder: ["A", "B", "C"],
} as unknown as CompetitiveProfileConfig;

const player = (userId: string, rank = "A"): PlayerStrengthInput => ({
  userId,
  label: userId,
  historicalPeak: { rank, rating: 1 },
  previousSeasonPeak: { rank, rating: 1 },
  currentSeasonPeak: { rank, rating: 1 },
});

const five = (prefix: string, rank = "A") => Array.from({ length: 5 }, (_, index) => player(`${prefix}-${index + 1}`, rank));

describe("buildTeamSeedRecommendations", () => {
  it("averages exactly five frozen starters and ranks the stronger team first", () => {
    const result = buildTeamSeedRecommendations([
      { teamId: "weak", teamName: "Weak", starters: five("weak", "A") },
      { teamId: "strong", teamName: "Strong", starters: five("strong", "C") },
    ], config);

    expect(result[0]).toMatchObject({ teamId: "strong", recommendationRank: 1, teamSeedStrength: 3 });
    expect(result[1]).toMatchObject({ teamId: "weak", recommendationRank: 2, teamSeedStrength: 1 });
  });

  it.each([
    ["fewer than five", five("short").slice(0, 4)],
    ["more than five", [...five("long"), player("long-6")]],
  ])("fails closed when there are %s primary starters", (_label, starters) => {
    const result = buildTeamSeedRecommendations([{ teamId: "team", teamName: "Team", starters }], config);
    expect(result[0]?.available).toBe(false);
    expect(result[0]?.teamSeedStrength).toBeNull();
  });

  it("fails closed for missing evidence and an unknown rank mapping", () => {
    const missing = player("missing");
    missing.currentSeasonPeak = null;
    const unknown = player("unknown", "not-in-policy");
    const result = buildTeamSeedRecommendations([
      { teamId: "missing", teamName: "Missing", starters: [...five("missing").slice(0, 4), missing] },
      { teamId: "unknown", teamName: "Unknown", starters: [...five("unknown").slice(0, 4), unknown] },
    ], config);
    expect(result.every((row) => !row.available)).toBe(true);
    expect(result.flatMap((row) => row.blockers).join("\n")).toContain("缺少当前赛季最高段位");
    expect(result.flatMap((row) => row.blockers).join("\n")).toContain("不在本赛事公布的段位映射");
  });

  it("keeps exact strength ties in one tie group while using names only for display order", () => {
    const result = buildTeamSeedRecommendations([
      { teamId: "z", teamName: "Zulu", starters: five("z", "B") },
      { teamId: "a", teamName: "Alpha", starters: five("a", "B") },
    ], config);
    expect(result.map((row) => row.teamId)).toEqual(["a", "z"]);
    expect(result.map((row) => row.recommendationRank)).toEqual([1, 1]);
    expect(result.map((row) => row.tieGroup)).toEqual([1, 1]);
  });
});

describe("seed recommendation snapshot contract", () => {
  it("persists a versioned payload with the frozen set, provenance, and five starters", () => {
    const frozenTeams = [{
      identity: {
        entrantId: "entrant-1",
        competitionEntryId: "entry-1",
        eventRosterId: "roster-1",
        sourceRosterRevisionId: "revision-1",
        teamName: "Team",
        members: five("team").map((member) => ({ userId: member.userId, participantId: null, educationVerificationId: `edu-${member.userId}`, isPrimaryStarter: true })),
      },
      starters: five("team"),
    }];
    const payload = buildSeedRecommendationSnapshotPayload({ seasonId: "season-1", frozenTeams, competitiveContext: config });
    const fingerprint = buildFrozenSetFingerprint("season-1", [frozenTeams[0]!.identity]);
    expect(payload.context).toMatchObject({ version: 1, seasonId: "season-1", frozenSetFingerprint: fingerprint });
    expect(payload.recommendations[0]?.starters).toHaveLength(5);
    expect(getSeedRecommendationSnapshotStatus({ snapshot: { entrantSetFingerprint: fingerprint, context: payload.context, recommendations: payload.recommendations }, seasonId: "season-1", frozenSetFingerprint: fingerprint })).toBe("ready");
    expect(getSeedRecommendationSnapshotStatus({ snapshot: { entrantSetFingerprint: "other", context: payload.context, recommendations: payload.recommendations }, seasonId: "season-1", frozenSetFingerprint: fingerprint })).toBe("mismatch");
  });

  it("detects a final human order crossing recommendation groups without changing the snapshot", () => {
    const recommendations = [
      { competitionEntryId: "strong", recommendationRank: 1, tieGroup: 1, displayOrder: 1 },
      { competitionEntryId: "weak", recommendationRank: 2, tieGroup: 2, displayOrder: 2 },
    ];
    expect(analyzeFinalSeedOrder(["strong", "weak"], recommendations).divergesFromRecommendation).toBe(false);
    expect(analyzeFinalSeedOrder(["weak", "strong"], recommendations)).toMatchObject({ divergesFromRecommendation: true, resolvesSystemTie: false });
  });
});
