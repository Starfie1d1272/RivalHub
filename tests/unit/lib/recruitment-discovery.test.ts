import { describe, expect, it } from "vitest";
import { hasPlayableMapPreference, recruitmentTeamSizeMatches } from "@/lib/recruitment/data";

describe("公开组队发现筛选", () => {
  it.each([
    [4, "small", true],
    [5, "small", false],
    [4, "medium", false],
    [5, "medium", true],
    [6, "medium", true],
    [7, "medium", false],
    [6, "large", false],
    [7, "large", true],
  ] as const)("按 %s 人边界匹配 %s 队伍规模为 %s", (memberCount, size, expected) => {
    expect(recruitmentTeamSizeMatches(memberCount, size)).toBe(expected);
  });

  it("只把目标图池中 playable+ 的地图视为匹配", () => {
    const preferences = [
      { map: "de_mirage", level: "none" as const },
      { map: "de_inferno", level: "basic" as const },
      { map: "de_nuke", level: "playable" as const },
      { map: "de_ancient", level: "proficient" as const },
      { map: "de_dust2", level: "strong" as const },
      { map: "de_anubis", level: null },
    ];

    expect(hasPlayableMapPreference(preferences, "de_mirage")).toBe(false);
    expect(hasPlayableMapPreference(preferences, "de_inferno")).toBe(false);
    expect(hasPlayableMapPreference(preferences, "de_nuke")).toBe(true);
    expect(hasPlayableMapPreference(preferences, "de_ancient")).toBe(true);
    expect(hasPlayableMapPreference(preferences, "de_dust2")).toBe(true);
    expect(hasPlayableMapPreference(preferences, "de_anubis")).toBe(false);
  });
});
