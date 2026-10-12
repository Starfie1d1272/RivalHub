import { describe, expect, it } from "vitest";
import { seasonEntries } from "./entries";
// Protect capability-gated destinations and the permanent Rivals archive entry points.
describe("season entry capability contract", () => {
  it("keeps voting and draft destinations readable after completion", () => {
    const entries = seasonEntries({ slug: "rivals", status: "archived", hasCaptainVoting: true, hasDraft: true, hasMatches: true, hasStats: true });
    expect(entries.filter(row => row.canRead).map(row => row.key)).toContain("captains");
    expect(entries.find(row => row.key === "draft")).toMatchObject({ href: "/rivals/draft", canRead: true, canAct: false });
  });
  it("does not manufacture draft or prediction capabilities", () => {
    const entries = seasonEntries({ slug: "custom", status: "playing", hasCaptainVoting: false, hasDraft: false, hasMatches: false, hasStats: false });
    expect(entries.filter(row => row.canRead).map(row => row.key)).toEqual(["overview", "teams", "players", "info"]);
    expect(entries[0]!.matches("/custom-other")).toBe(false);
  });
});
