import { describe, expect, it } from "vitest";
import {
  buildHomeEyebrow,
  buildHomeNavEntries,
  selectHomeNavTiers,
} from "./navigation";

describe("home navigation helpers", () => {
  it("prioritizes registration when a solo season is registering", () => {
    const entries = buildHomeNavEntries({
      slug: "nju-rivals-2026",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
    });
    const tiers = selectHomeNavTiers(entries, "registration");

    expect(tiers.tier1Entry?.key).toBe("register");
    expect(tiers.tier2Entries.map((entry) => entry.key)).toEqual([
      "captains",
      "draft",
      "teams",
      "matches",
    ]);
    expect(tiers.tier3Entries.map((entry) => entry.key)).toEqual([
      "stats",
      "seasons",
      "login",
    ]);
  });

  it("omits capability-gated entries when the season does not support them", () => {
    const entries = buildHomeNavEntries({
      slug: "open-cup",
      registrationMode: "team",
      hasCaptainVoting: false,
      hasDraft: false,
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      "teams",
      "matches",
      "stats",
      "seasons",
      "login",
    ]);
  });

  it("describes the active phase eyebrow", () => {
    expect(buildHomeEyebrow("voting", "nju-rivals-2026")).toEqual({
      text: "● CAPTAIN VOTING",
      color: "var(--color-warn)",
    });

    expect(buildHomeEyebrow("finished", "nju-rivals-2026")).toEqual({
      text: "[ RIVALHUB / NJU RIVALS 2026 ]",
      color: "var(--color-accent)",
    });
  });
});
