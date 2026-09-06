import { describe, expect, it } from "vitest";
import { isValidPrTitle } from "../../../scripts/ci/validate-pr-title.mjs";

describe("pull request title validator", () => {
  it.each([
    "feat(major): 补齐赛前冻结",
    "fix: 修复移动端溢出",
    "chore(deps): bump next from 16.3.3 to 16.3.4",
    "chore(deps-dev): bump vitest from 4.1.10 to 4.1.11",
    "release: v2.5.0",
  ])("accepts %s", (title) => {
    expect(isValidPrTitle(title)).toBe(true);
  });

  it.each(["[2.x] 修复移动端溢出", "修复移动端溢出", "feature: 新功能", "fix:", "feat(major): "]) (
    "rejects %s",
    (title) => {
      expect(isValidPrTitle(title)).toBe(false);
    },
  );
});
