import { describe, expect, it } from "vitest";
import { recruitmentHref, resolveRecruitmentView } from "@/lib/recruitment/contract";

describe("recruitment lobby contract", () => {
  it.each([
    ["players", true, true, "players"],
    ["teams", false, false, "teams"],
    [undefined, true, true, "teams"],
    [undefined, false, true, "players"],
    [undefined, false, false, "teams"],
  ] as const)("resolves view %s with LFT=%s captain=%s", (explicit, hasOpenLft, isCaptain, expected) => {
    expect(resolveRecruitmentView(explicit, hasOpenLft, isCaptain)).toBe(expected);
  });

  it("keeps the explicit task view and supported filters through login", () => {
    expect(recruitmentHref("players", {
      targetSeasonId: "season-1",
      q: "主狙",
      position: "awper",
      teamSize: "small",
      map: "de_mirage",
    })).toBe("/teams/recruitment?view=players&event=season-1&q=%E4%B8%BB%E7%8B%99&position=awper&size=small&map=de_mirage");
  });
});
