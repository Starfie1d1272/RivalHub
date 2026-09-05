import { describe, expect, it } from "vitest";
import type { CompetitiveProfileConfig } from "@/types/season";
import {
  analyzeFinalSeedOrder,
  buildTeamSeedRecommendations,
} from "./team-seed-recommendation";
import {
  buildFrozenSetFingerprint,
  buildSeedRecommendationSnapshotPayload,
  getSeedRecommendationSnapshotStatus,
  snapshotPayloadsEqual,
} from "./seed-recommendation-snapshot";
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

  it("uses a stable scaled score for equal mathematical averages with different compositions", () => {
    const ranked = (prefix: string, ranks: string[]) => ranks.map((rank, index) => player(`${prefix}-${index + 1}`, rank));
    const result = buildTeamSeedRecommendations([
      { teamId: "left", teamName: "Left", starters: ranked("left", ["A", "A", "A", "C", "C"]) },
      { teamId: "right", teamName: "Right", starters: ranked("right", ["A", "A", "B", "B", "C"]) },
    ], config);

    expect(result[0]).toMatchObject({ teamSeedStrength: 1.8, teamSeedStrengthScaled: 180, recommendationRank: 1, tieGroup: 1 });
    expect(result[1]).toMatchObject({ teamSeedStrength: 1.8, teamSeedStrengthScaled: 180, recommendationRank: 1, tieGroup: 1 });
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

  it("persists the effective recent fact selected by the strength policy", () => {
    const policyConfig = {
      ...config,
      evidencePolicy: {
        historicalWeight: 50,
        referenceSeasonKey: "previous",
        referenceSeasonWeight: 20,
        recentSeasonKeys: ["older", "current"],
        recentSeasonWeight: 30,
      },
    } as CompetitiveProfileConfig;
    const starter = player("effective-recent");
    starter.currentSeasonPeak = { rank: "A", rating: 1, sourceSeasonKey: "current" };
    starter.recentSeasonPeaks = [
      { rank: "C", rating: 3, sourceSeasonKey: "older" },
      { rank: "A", rating: 1, sourceSeasonKey: "current" },
    ];
    const payload = buildSeedRecommendationSnapshotPayload({
      seasonId: "season-1",
      frozenTeams: [{
        identity: {
          entrantId: "entrant-1",
          competitionEntryId: "entry-1",
          eventRosterId: "roster-1",
          sourceRosterRevisionId: "revision-1",
          teamName: "Team",
          members: five("effective-recent").map((member) => ({ userId: member.userId, participantId: null, educationVerificationId: `edu-${member.userId}`, isPrimaryStarter: true })),
        },
        starters: Array.from({ length: 5 }, (_, index) => ({ ...starter, userId: `effective-recent-${index + 1}`, label: `effective-recent-${index + 1}` })),
      }],
      competitiveContext: policyConfig,
    });
    expect(payload.recommendations[0]?.starters[0]?.breakdown).toMatchObject({
      currentValue: 3,
      effectiveRecentPeak: { rank: "C", sourceSeasonKey: "older" },
    });
  });

  it("remains ready and idempotent after a PostgreSQL jsonb key-order round trip", () => {
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
    const reorderKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorderKeys);
      if (typeof value !== "object" || value === null) return value;
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().reverse().map((key) => [key, reorderKeys(record[key])]));
    };
    const roundTrippedContext = reorderKeys(payload.context);
    const roundTrippedRecommendations = reorderKeys(payload.recommendations);
    const fingerprint = payload.context.frozenSetFingerprint;

    expect(getSeedRecommendationSnapshotStatus({
      snapshot: {
        entrantSetFingerprint: fingerprint,
        context: roundTrippedContext,
        recommendations: roundTrippedRecommendations,
      },
      seasonId: "season-1",
      frozenSetFingerprint: fingerprint,
    })).toBe("ready");
    expect(snapshotPayloadsEqual({ context: roundTrippedContext, recommendations: roundTrippedRecommendations }, payload)).toBe(true);
  });

  it("detects a final human order crossing recommendation groups without changing the snapshot", () => {
    const recommendations = [
      { competitionEntryId: "strong", recommendationRank: 1, tieGroup: 1, displayOrder: 1 },
      { competitionEntryId: "weak", recommendationRank: 2, tieGroup: 2, displayOrder: 2 },
    ];
    expect(analyzeFinalSeedOrder(["strong", "weak"], recommendations).divergesFromRecommendation).toBe(false);
    expect(analyzeFinalSeedOrder(["weak", "strong"], recommendations)).toMatchObject({ divergesFromRecommendation: true, resolvesSystemTie: false });
  });

  it("labels internal tie ordering separately from a cross-group adjustment", () => {
    const recommendations = [
      { competitionEntryId: "alpha", recommendationRank: 1, tieGroup: 1, displayOrder: 1 },
      { competitionEntryId: "bravo", recommendationRank: 1, tieGroup: 1, displayOrder: 2 },
      { competitionEntryId: "charlie", recommendationRank: 3, tieGroup: 2, displayOrder: 3 },
    ];
    expect(analyzeFinalSeedOrder(["bravo", "alpha", "charlie"], recommendations)).toMatchObject({
      divergesFromRecommendation: false,
      resolvesSystemTie: true,
      rowStatusByTeamId: { alpha: "tie_resolved", bravo: "tie_resolved", charlie: "aligned" },
      finalSeedByTeamId: { alpha: 2, bravo: 1, charlie: 3 },
    });
    expect(analyzeFinalSeedOrder(["charlie", "alpha", "bravo"], recommendations)).toMatchObject({
      divergesFromRecommendation: true,
      resolvesSystemTie: false,
      rowStatusByTeamId: { alpha: "adjusted", bravo: "adjusted", charlie: "adjusted" },
    });
  });
});
