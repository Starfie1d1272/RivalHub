import { describe, it, expect } from "vitest";
import { PERFECTWORLD_STAT_PROFILE, ALL_STAT_FIELDS } from "./stat-profile";

describe("PERFECTWORLD_STAT_PROFILE", () => {
  it("provider 为 perfectworld 且 rankMetric 为 ratingPro", () => {
    expect(PERFECTWORLD_STAT_PROFILE.provider).toBe("perfectworld");
    expect(PERFECTWORLD_STAT_PROFILE.rankMetric).toBe("ratingPro");
  });
  it("inputFields 覆盖全部 11 个统计字段", () => {
    expect(PERFECTWORLD_STAT_PROFILE.inputFields).toEqual(ALL_STAT_FIELDS);
    expect(ALL_STAT_FIELDS).toHaveLength(11);
  });
  it("rankMetric 必须属于 inputFields", () => {
    expect(PERFECTWORLD_STAT_PROFILE.inputFields).toContain(
      PERFECTWORLD_STAT_PROFILE.rankMetric,
    );
  });
});
