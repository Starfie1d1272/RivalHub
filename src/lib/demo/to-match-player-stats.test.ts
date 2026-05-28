import { describe, it, expect } from "vitest";
import { toMatchPlayerStat } from "./to-match-player-stats";

describe("toMatchPlayerStat", () => {
  const base = {
    steamId64: "76561198000000001",
    teamKey: "teamA",
    kills: 10,
    deaths: 5,
    assists: 3,
    adr: 85.5,
    headshotCount: 4,
    firstKillCount: 2,
    threeKillCount: 1,
    fourKillCount: 1,
    fiveKillCount: 0,
    vsOneCount: 1, vsOneWonCount: 1,
    vsTwoCount: 1, vsTwoWonCount: 0,
    vsThreeCount: 0, vsThreeWonCount: 0,
    vsFourCount: 0, vsFourWonCount: 0,
    vsFiveCount: 0, vsFiveWonCount: 0,
  };

  it("透传 kills/deaths/adr", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.kills).toBe(10);
    expect(result.deaths).toBe(5);
    expect(result.adr).toBe(85.5);
  });

  it("hsPercent = round(headshotCount/kills*100)", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.hsPercent).toBe(40); // 4/10*100 = 40
  });

  it("firstKills 透传 firstKillCount", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.firstKills).toBe(2);
  });

  it("multiKills = three+four+five", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.multiKills).toBe(2); // 1+1+0
  });

  it("clutches = vsN won 合计", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.clutches).toBe(1); // vsOneWonCount=1, vsTwoWonCount=0
  });

  it("source = demo_import", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.source).toBe("demo_import");
  });

  it("ratingPro/rws/we 为 undefined", () => {
    const result = toMatchPlayerStat(base, "AlphaOne", "user-1");
    expect(result.ratingPro).toBeUndefined();
    expect(result.rws).toBeUndefined();
    expect(result.we).toBeUndefined();
  });

  it("kills=0 时 hsPercent=0 不除以零", () => {
    const result = toMatchPlayerStat({ ...base, kills: 0, headshotCount: 0 }, "AlphaOne", "user-1");
    expect(result.hsPercent).toBe(0);
  });
});
