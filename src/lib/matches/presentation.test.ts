import { describe, expect, it } from "vitest";
import { presentMatchFormat, presentMatchLabel, presentMatchStatus } from "@/lib/matches/presentation";

describe("match status presentation", () => {
  it("keeps match status labels readable in public surfaces", () => {
    expect(presentMatchStatus("in_progress")).toEqual({ label: "待进行", tone: "neutral" });
    expect(presentMatchStatus("finished")).toEqual({ label: "已结束", tone: "success" });
    expect(presentMatchFormat("bo3")).toEqual({ label: "BO3", tone: "neutral" });
  });

  it("keeps cross-surface match labels human-readable", () => {
    expect(presentMatchLabel({ stage: "playoff", stageName: "淘汰赛", entryRound: "半决赛", teamAName: "Alpha", teamBName: "Beta" })).toBe("淘汰赛 · 半决赛 · Alpha vs Beta");
  });
});
