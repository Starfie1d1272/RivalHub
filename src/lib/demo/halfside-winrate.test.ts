import { describe, it, expect } from "vitest";
import { halfSideWinRate } from "./halfside-winrate";

describe("halfSideWinRate", () => {
  it("统计某队 T/CT 半场胜率", () => {
    const rounds = [
      { teamSide: "ct", won: true },
      { teamSide: "ct", won: false },
      { teamSide: "t", won: true },
    ];
    const r = halfSideWinRate(rounds);
    expect(r.ct).toEqual({ played: 2, won: 1, winRate: 0.5 });
    expect(r.t).toEqual({ played: 1, won: 1, winRate: 1 });
  });

  it("处理空数组", () => {
    const r = halfSideWinRate([]);
    expect(r).toEqual({});
  });

  it("处理全胜", () => {
    const rounds = [
      { teamSide: "ct", won: true },
      { teamSide: "ct", won: true },
    ];
    const r = halfSideWinRate(rounds);
    expect(r.ct).toEqual({ played: 2, won: 2, winRate: 1 });
  });

  it("处理全败", () => {
    const rounds = [
      { teamSide: "t", won: false },
      { teamSide: "t", won: false },
    ];
    const r = halfSideWinRate(rounds);
    expect(r.t).toEqual({ played: 2, won: 0, winRate: 0 });
  });

  it("处理未知 side", () => {
    const rounds = [
      { teamSide: "ct", won: true },
      { teamSide: "unknown_side", won: true },
    ];
    const r = halfSideWinRate(rounds);
    expect(r.ct).toEqual({ played: 1, won: 1, winRate: 1 });
    expect(r.unknown_side).toEqual({ played: 1, won: 1, winRate: 1 });
  });
});
