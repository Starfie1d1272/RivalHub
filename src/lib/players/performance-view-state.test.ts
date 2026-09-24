import { describe, expect, it } from "vitest";
import { parsePlayerPerformanceQuery, playerPerformanceHref } from "./performance-view-state";

const events = [
  { slug: "event-a", maps: ["de_dust2", "de_mirage"] },
  { slug: "event-b", maps: ["de_nuke"] },
];

describe("player performance URL scope", () => {
  it("omits default scope and restores valid event/map filters", () => {
    expect(parsePlayerPerformanceQuery({})).toEqual({ event: "", map: "" });
    expect(parsePlayerPerformanceQuery({ event: "event-a", map: "de_mirage" })).toEqual({ event: "event-a", map: "de_mirage" });
    expect(parsePlayerPerformanceQuery({ event: ["event-a", "event-b"], map: "invalid" })).toEqual({ event: "", map: "" });
  });

  it("keeps a map when it exists in the new event and clears it otherwise", () => {
    expect(playerPerformanceHref("user-1", { event: "event-a", map: "de_dust2" }, { event: "" }, events))
      .toBe("/players/user-1?map=de_dust2");
    expect(playerPerformanceHref("user-1", { event: "event-a", map: "de_mirage" }, { event: "event-b" }, events))
      .toBe("/players/user-1?event=event-b");
  });

  it("omits All-time and All maps defaults", () => {
    expect(playerPerformanceHref("user-1", { event: "event-a", map: "de_mirage" }, { event: "", map: "" }, events))
      .toBe("/players/user-1");
  });
});
