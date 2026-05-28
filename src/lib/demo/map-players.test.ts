import { describe, it, expect } from "vitest";
import { mapDemoPlayers } from "./map-players";

describe("mapDemoPlayers", () => {
  it("能映射的填 userId,不能的留 null 并标记 unmatched", () => {
    const demoPlayers = [
      { steamId64: "111", name: "Alice", teamKey: "teamA" },
      { steamId64: "999", name: "Ghost", teamKey: "teamB" },
    ];
    const known = new Map([["111", "user-uuid-1"]]);
    const { mapped, unmatched } = mapDemoPlayers(demoPlayers, known);
    expect(mapped[0].userId).toBe("user-uuid-1");
    expect(mapped[1].userId).toBeNull();
    expect(unmatched).toEqual(["Ghost"]);
  });
});
