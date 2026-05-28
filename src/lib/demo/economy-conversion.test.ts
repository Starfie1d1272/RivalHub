import { describe, it, expect } from "vitest";
import { economyConversion } from "./economy-conversion";

describe("economyConversion", () => {
  it("按经济类型统计某队回合胜率", () => {
    const rounds = [
      { teamKey: "teamA", economy: "full", won: true },
      { teamKey: "teamA", economy: "full", won: false },
      { teamKey: "teamA", economy: "eco", won: true },
    ];
    const r = economyConversion(rounds);
    expect(r.full).toEqual({ played: 2, won: 1, winRate: 0.5 });
    expect(r.eco).toEqual({ played: 1, won: 1, winRate: 1 });
  });

  it("处理无数据输入", () => {
    const r = economyConversion([]);
    expect(r).toEqual({});
  });

  it("处理多种经济类型", () => {
    const rounds = [
      { teamKey: "teamA", economy: "full", won: true },
      { teamKey: "teamA", economy: "force", won: false },
      { teamKey: "teamA", economy: "semi", won: true },
    ];
    const r = economyConversion(rounds);
    expect(r.full).toEqual({ played: 1, won: 1, winRate: 1 });
    expect(r.force).toEqual({ played: 1, won: 0, winRate: 0 });
    expect(r.semi).toEqual({ played: 1, won: 1, winRate: 1 });
  });

  it("经济类型不硬编码，对任意字符串分组", () => {
    const rounds = [
      { teamKey: "teamA", economy: "pistol", won: true },
      { teamKey: "teamA", economy: "pistol", won: false },
      { teamKey: "teamA", economy: "unknown_type", won: true },
    ];
    const r = economyConversion(rounds);
    expect(r.pistol).toEqual({ played: 2, won: 1, winRate: 0.5 });
    expect(r.unknown_type).toEqual({ played: 1, won: 1, winRate: 1 });
  });
});
