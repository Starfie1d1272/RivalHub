import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { describe, expect, it } from "vitest";
import { buildTournamentResults } from "./results";
import { buildRecords } from "./records";
import { publicStatsView } from "./public-view";
import { parseStatsQuery } from "./view-state";
import type { TournamentStats } from "./tournament-query";
function source(): TournamentStats {
  const labels = { teams: {}, players: {} };
  return { leaderboard: [], teamRatings: [], analytics: buildTournamentAnalytics([], { labels }),
    performance: buildTournamentPerformanceAnalytics([], { labels }), results: buildTournamentResults([], [], []),
    selection: [], veto: { teams: [], sample: { finishedMatches: 0, applicableMatches: 0, recordedMatches: 0, missingMatches: 0, notApplicableMatches: 0 } }, coverage: { detailedMaps: 0, completedMaps: 0, maps: [] },
    options: { teams: [], maps: [] }, recordTies: [], records: buildRecords([]), insights: [], recordCoverage: { maps: 0, economyRounds: 0 } };
}
describe("public statistics DTO", () => {
  it("includes Records only for Records and Insights only for Overview", () => {
    const data = source();
    data.analytics.provenance = { semanticProfile: "internal-profile", analysisVersions: ["internal-version"] };
    data.performance.provenance = { semanticProfile: "internal-profile", analysisVersions: ["internal-version"] };
    for (const tab of ["overview", "players", "teams", "maps", "weapons", "records"]) {
      const dto = publicStatsView(data, parseStatsQuery({ tab }, []));
      expect(dto).not.toHaveProperty("recordTies");
      expect(dto.records).toEqual(tab === "records" ? data.records : undefined);
      expect(dto.insights).toEqual(tab === "overview" ? [] : undefined);
      expect(dto.analytics.provenance).toEqual({ semanticProfile: null, analysisVersions: [] });
      expect(dto.performance.provenance).toEqual({ semanticProfile: null, analysisVersions: [] });
    }
  });
  it("does not mutate the shared cached aggregate while selecting a view", () => {
    const data = source(), before = JSON.stringify(data);
    publicStatsView(data, parseStatsQuery({ tab: "players" }, []));
    expect(JSON.stringify(data)).toBe(before);
  });
});
