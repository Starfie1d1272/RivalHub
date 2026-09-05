import { describe, expect, it } from "vitest";
import { buildTeamSeedRecommendations } from "./team-seed-recommendation";
import type { CompetitiveProfileConfig } from "@/types/season";
const config = { platform: "perfect-world", currentSeasonKey: "current", previousSeasonKey: "previous", rankOrder: ["A", "B", "C"] } as unknown as CompetitiveProfileConfig;
const player = (userId: string, rank = "A") => ({ userId, label: userId, historicalPeak: { rank, rating: 1 }, previousSeasonPeak: { rank, rating: 1 }, currentSeasonPeak: { rank, rating: 1 } });
describe("buildTeamSeedRecommendations", () => {
  it("averages five starters and preserves ties", () => { const result = buildTeamSeedRecommendations([{ teamId: "a", teamName: "A", starters: [player("a1"), player("a2"), player("a3"), player("a4"), player("a5")] }, { teamId: "b", teamName: "B", starters: [player("b1"), player("b2"), player("b3"), player("b4"), player("b5")] }], config); expect(result.map((row) => row.recommendationRank)).toEqual([1, 1]); expect(result[0]?.teamSeedStrength).toBe(1); });
  it("fails closed when starters are incomplete", () => { const result = buildTeamSeedRecommendations([{ teamId: "a", teamName: "A", starters: [player("a1")] }], config); expect(result[0]?.available).toBe(false); });
});
