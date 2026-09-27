import { describe, expect, it } from "vitest";
import { buildTeamRatings } from "./team-rating";

describe("team rating aggregation", () => {
  it("averages existing player-map Rating observations instead of averaging player means equally", () => {
    expect(buildTeamRatings([
      { teamId: "team-a", avgRating: 1.2, ratingSamples: 3 },
      { teamId: "team-a", avgRating: 0.9, ratingSamples: 1 },
      { teamId: "team-b", avgRating: 1.05, ratingSamples: 2 },
      { teamId: null, avgRating: 2, ratingSamples: 5 },
    ])).toEqual([
      { entryId: "team-a", rating: 1.125, ratingSamples: 4 },
      { entryId: "team-b", rating: 1.05, ratingSamples: 2 },
    ]);
  });

  it("ignores missing Rating observations", () => {
    expect(buildTeamRatings([
      { teamId: "team-a", avgRating: null, ratingSamples: 0 },
    ])).toEqual([]);
  });
});
