import { describe, expect, it } from "vitest";
import { normalizeLeaderboardState } from "./leaderboard-view";

describe("normalizeLeaderboardState", () => {
  it("opens legacy impact sort links in the impact view", () => {
    expect(normalizeLeaderboardState({ sort: "fk" })).toEqual({
      sort: "fk",
      view: "impact",
    });
  });

  it("falls back to the current view default when sort is incompatible", () => {
    expect(normalizeLeaderboardState({ sort: "we", view: "impact" })).toEqual({
      sort: "fk",
      view: "impact",
    });
  });
});
