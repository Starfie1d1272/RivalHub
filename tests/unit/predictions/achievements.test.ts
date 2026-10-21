import { describe, expect, it } from "vitest";
import { stageTasks, rankPickEmAchievements } from "@/lib/predictions/achievements";
import { coinLevel, defaultPredictionRules } from "@/lib/predictions/rules";
import { MAJOR_24_STAGE_PLAN } from "@/lib/competition/templates";
import { projectPredictionStages } from "@/lib/predictions/stage-projection";

const input = { type: "swiss" as const, target: 5, submitted: false, locked: false, closed: false, available: true, voided: false, result: null };
describe("Pick’Em achievement projection", () => {
  it("counts complete submission immediately and distinguishes late, unsuccessful and voided tasks", () => {
    expect(stageTasks({ ...input, submitted: true }).map(x => x.state)).toEqual(["complete", "active"]);
    expect(stageTasks({ ...input, submitted: true, locked: true, closed: true, result: { hits: 8, challenges: [] } }).map(x => x.state)).toEqual(["complete", "complete"]);
    expect(stageTasks({ ...input, submitted: true, locked: true, closed: true, result: { hits: 4, challenges: [] } }).map(x => x.state)).toEqual(["complete", "failed"]);
    expect(stageTasks(input).map(x => x.state)).toEqual(["active", "active"]);
    expect(stageTasks({ ...input, submitted: true, voided: true })[0]?.progress).toBe(0);
    expect(stageTasks({ ...input, closed: true }).every(x => x.state === "missed")).toBe(true);
    expect(stageTasks({ ...input, submitted: true, locked: true, voided: true }).every(x => x.state === "void")).toBe(true);
  });
  it("projects all playoff goals separately from raw hit totals", () => {
    const tasks = stageTasks({ ...input, type: "single_elim", submitted: true, locked: true, closed: true, result: { hits: 4, challenges: [true, false, true] } });
    expect(tasks.map(x => x.state)).toEqual(["complete", "complete", "failed", "complete"]);
  });
  it("shares rank by tasks, ordering hits only within a shared rank", () => {
    const row = { name: "观众", coin: "白银" };
    expect(rankPickEmAchievements([
      { ...row, accountId: "a", challenges: 2, hits: 6 },
      { ...row, accountId: "b", challenges: 2, hits: 9 },
      { ...row, accountId: "c", challenges: 1, hits: 20 },
    ], "a")).toEqual([
      { name: "观众", coin: "白银", value: "2", rank: 1, isMe: false },
      { name: "观众", coin: "白银", value: "2", rank: 1, isMe: true },
      { name: "观众", coin: "白银", value: "1", rank: 3, isMe: false },
    ]);
  });
  it("uses 2/5/8 for eight challenges, retaining copper at the first complete submission", () => {
    const rules = defaultPredictionRules(projectPredictionStages(MAJOR_24_STAGE_PLAN));
    expect([rules.silver, rules.gold, rules.diamond]).toEqual([2, 5, 8]);
    expect([0, 1, 2, 4, 5, 7, 8].map(n => coinLevel(n > 0 ? 1 : 0, n, rules))).toEqual(["未获得", "青铜", "白银", "白银", "黄金", "黄金", "钻石"]);
  });
});
