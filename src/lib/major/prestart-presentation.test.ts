import { describe, expect, it } from "vitest";
import { presentMajorPrestartReadiness } from "./prestart-presentation";
import type { MajorPrestartReadiness } from "./prestart";

const readiness: MajorPrestartReadiness = {
  canStart: false,
  blockers: ["请先锁定正式参赛队和最终赛事名单。", "队伍 A 存在重复选手。"],
  openingPlan: null,
  checks: [
    { key: "rules", label: "标准 Major 规则", state: "ready", blockers: [] },
    { key: "entrants-locked", label: "正式参赛队锁定", state: "blocked", blockers: ["请先锁定正式参赛队和最终赛事名单。"] },
    { key: "duplicate-players", label: "重复选手检查", state: "blocked", blockers: ["队伍 A 存在重复选手。"] },
  ],
};

describe("Major prestart operator presentation", () => {
  it("keeps ready system invariants out of the operator task flow", () => {
    const result = presentMajorPrestartReadiness(readiness);

    expect(result.tasks).toEqual([{ label: "确定正式参赛队", state: "blocked", detail: "请先锁定正式参赛队和最终赛事名单。" }]);
    expect(result.systemBlockers).toEqual([{ label: "重复选手检查", state: "blocked", detail: "队伍 A 存在重复选手。" }]);
    expect(result.tasks.map((task) => task.label)).not.toContain("标准 Major 规则");
  });
});
