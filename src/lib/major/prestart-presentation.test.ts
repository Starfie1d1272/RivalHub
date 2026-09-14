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

    expect(result.tasks).toEqual([
      { label: "确定正式参赛队", state: "blocked", detail: "请先锁定正式参赛队和最终赛事名单。" },
      { label: "处理重复选手", state: "blocked", detail: "队伍 A 存在重复选手。" },
    ]);
    expect(result.systemBlockers).toEqual([]);
    expect(result.tasks.map((task) => task.label)).not.toContain("标准 Major 规则");
  });

  it("does not promote derived seed failures while entrant selection is blocked", () => {
    const result = presentMajorPrestartReadiness({
      canStart: false,
      blockers: ["当前有 4 支队伍，Major 开赛需要恰好 32 支队伍。", "赛事种子 1 尚未分配。"],
      openingPlan: null,
      checks: [
        { key: "rules", label: "标准 Major 规则", state: "ready", blockers: [] },
        { key: "teams", label: "32 支参赛队伍", state: "blocked", blockers: ["当前有 4 支队伍，Major 开赛需要恰好 32 支队伍。"] },
        { key: "entrants-locked", label: "正式参赛队锁定", state: "blocked", blockers: ["请先锁定正式参赛队和最终赛事名单。"] },
        { key: "rosters", label: "队伍名单", state: "ready", blockers: [] },
        { key: "duplicate-players", label: "重复选手检查", state: "ready", blockers: [] },
        { key: "confirmations", label: "参赛确认", state: "ready", blockers: [] },
        { key: "qualification", label: "资格事项", state: "ready", blockers: [] },
        { key: "administration", label: "管理事项", state: "ready", blockers: [] },
        { key: "seeds", label: "赛事 1–32 种子", state: "blocked", blockers: ["赛事种子 1 尚未分配。"] },
        { key: "seed-recommendation", label: "系统种子参考", state: "blocked", blockers: ["系统种子参考尚未生成。"] },
        { key: "reconfirmations", label: "种子重新确认", state: "blocked", blockers: ["赛事种子已变化，必须重新确认后才能开赛。"] },
        { key: "opening-plan", label: "开赛计划", state: "blocked", blockers: ["开赛计划不可用。"] },
      ],
    });

    expect(result.tasks).toEqual([{
      label: "确定正式参赛队",
      state: "blocked",
      detail: "当前有 4 支队伍，Major 开赛需要恰好 32 支队伍。",
    }]);
    expect(result.systemBlockers).toEqual([]);
  });
});
