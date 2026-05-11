import { describe, expect, it } from "vitest";
import {
  getPickNumber,
  DRAFT_TOTAL_ROUNDS,
  DRAFT_TEAMS,
} from "@/types/draft";

describe("getPickNumber", () => {
  it("第 1 轮（奇数轮已显示）第 0 队（种子#1）pick 序号为 1", () => {
    expect(getPickNumber(1, 0)).toBe(1);
  });

  it("第 1 轮最后一队（种子#8，teamIdx=7）pick 序号为 8", () => {
    expect(getPickNumber(1, 7)).toBe(8);
  });

  it("第 2 轮（偶数轮，反向）第 0 队（种子#1 出现在末尾）pick 序号为 16", () => {
    expect(getPickNumber(2, 0)).toBe(16);
  });

  it("第 2 轮第一队（反向起始=种子#8，teamIdx=7）pick 序号为 9", () => {
    expect(getPickNumber(2, 7)).toBe(9);
  });

  it("第 3 轮（正向）第 0 队 pick 序号为 17", () => {
    expect(getPickNumber(3, 0)).toBe(17);
  });

  it("蛇形顺序完整 6 轮共 48 pick", () => {
    const picks = new Set<number>();
    for (let r = 1; r <= DRAFT_TOTAL_ROUNDS; r++) {
      for (let i = 0; i < DRAFT_TEAMS; i++) {
        const pn = getPickNumber(r, i);
        expect(pn).toBeGreaterThanOrEqual(1);
        expect(pn).toBeLessThanOrEqual(48);
        picks.add(pn);
      }
    }
    expect(picks.size).toBe(48);
  });

  it("奇数轮正向：同一轮 teamIdx 越大 pickNumber 越大", () => {
    expect(getPickNumber(1, 0)).toBeLessThan(getPickNumber(1, 1));
    expect(getPickNumber(3, 0)).toBeLessThan(getPickNumber(3, 1));
    expect(getPickNumber(5, 0)).toBeLessThan(getPickNumber(5, 1));
  });

  it("偶数轮反向：同一轮 teamIdx 越大 pickNumber 越小", () => {
    expect(getPickNumber(2, 0)).toBeGreaterThan(getPickNumber(2, 1));
    expect(getPickNumber(4, 0)).toBeGreaterThan(getPickNumber(4, 1));
    expect(getPickNumber(6, 0)).toBeGreaterThan(getPickNumber(6, 1));
  });
});
