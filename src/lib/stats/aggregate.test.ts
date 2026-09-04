import { describe, expect, it } from "vitest";
import { aggregatePlayerRows, type StatRowInput } from "@/lib/stats/aggregate";

function row(overrides: Partial<StatRowInput> = {}): StatRowInput {
  return {
    userId: "user-1",
    perfectName: "Player",
    kills: null,
    deaths: null,
    assists: null,
    hsPercent: null,
    firstKills: null,
    multiKills: null,
    clutches: null,
    adr: null,
    rws: null,
    ratingPro: null,
    we: null,
    rounds: null,
    ...overrides,
  };
}

describe("aggregatePlayerRows", () => {
  it("returns null for incomplete raw totals while preserving complete zero totals", () => {
    const incomplete = aggregatePlayerRows([
      row({ kills: null, deaths: null, firstKills: null, rounds: 24 }),
      row({ kills: 0, deaths: 0, firstKills: 0, rounds: 30, ratingPro: 1.2 }),
    ]);

    expect(incomplete.kills).toBeNull();
    expect(incomplete.deaths).toBeNull();
    expect(incomplete.firstKills).toBeNull();
    expect(incomplete.kd).toBeNull();
    expect(incomplete.kpr).toBe(0);
    expect(incomplete.fkpr).toBe(0);
    expect(incomplete.ratingPro).toBeCloseTo(1.2, 10);
    expect(incomplete.totalRounds).toBe(54);

    const zero = aggregatePlayerRows([
      row({ kills: 0, deaths: 0, assists: 0, firstKills: 0, multiKills: 0, clutches: 0, adr: 0, rws: 0, ratingPro: 0, we: 0, rounds: 24 }),
      row({ kills: 0, deaths: 0, assists: 0, firstKills: 0, multiKills: 0, clutches: 0, adr: 0, rws: 0, ratingPro: 0, we: 0, rounds: 30 }),
    ]);

    expect(zero.kills).toBe(0);
    expect(zero.deaths).toBe(0);
    expect(zero.assists).toBe(0);
    expect(zero.firstKills).toBe(0);
    expect(zero.multiKills).toBe(0);
    expect(zero.clutches).toBe(0);
    expect(zero.kd).toBeNull();
    expect(zero.kpr).toBe(0);
    expect(zero.fkpr).toBe(0);
    expect(zero.totalRounds).toBe(54);
  });

  it("uses source-aligned weighted denominators", () => {
    const aggregate = aggregatePlayerRows([
      row({
        kills: 20,
        deaths: 10,
        hsPercent: null,
        adr: null,
        firstKills: 2,
        rounds: 24,
        ratingPro: 1.3,
        rws: 12,
        we: 9,
      }),
      row({
        kills: 10,
        deaths: 8,
        hsPercent: 60,
        adr: 80,
        firstKills: 1,
        rounds: 30,
        ratingPro: 1.1,
        rws: 10,
        we: 7,
      }),
    ]);

    expect(aggregate.adr).toBe(80);
    expect(aggregate.hsPercent).toBe(60);
    expect(aggregate.kpr).toBeCloseTo(30 / 54, 10);
    expect(aggregate.fkpr).toBeCloseTo(3 / 54, 10);
    expect(aggregate.ratingPro).toBeCloseTo(1.2, 10);
    expect(aggregate.rws).toBe(11);
    expect(aggregate.we).toBe(8);
  });

  it("returns null for incomplete totals and zero-denominator metrics", () => {
    const aggregate = aggregatePlayerRows([
      row({ rounds: 0, deaths: 0, kills: null, firstKills: 0, adr: 80, hsPercent: 50 }),
      row({ rounds: null, deaths: null, kills: null, firstKills: null, adr: null, hsPercent: null }),
    ]);

    expect(aggregate.totalRounds).toBeNull();
    expect(aggregate.kills).toBeNull();
    expect(aggregate.deaths).toBeNull();
    expect(aggregate.kd).toBeNull();
    expect(aggregate.kpr).toBeNull();
    expect(aggregate.fkpr).toBeNull();
    expect(aggregate.adr).toBeNull();
    expect(aggregate.hsPercent).toBeNull();
    expect(aggregate.ratingPro).toBeNull();
  });

  it("keeps KD unknown when kills and deaths come from different incomplete rows", () => {
    const aggregate = aggregatePlayerRows([
      row({ kills: 10, deaths: null, firstKills: 2, multiKills: 3, clutches: 1, rounds: 24 }),
      row({ kills: null, deaths: 5, firstKills: null, multiKills: 1, clutches: null, rounds: 30 }),
    ]);

    expect(aggregate.kills).toBeNull();
    expect(aggregate.deaths).toBeNull();
    expect(aggregate.firstKills).toBeNull();
    expect(aggregate.multiKills).toBe(4);
    expect(aggregate.clutches).toBeNull();
    expect(aggregate.kd).toBeNull();
    expect(aggregate.kpr).toBeCloseTo(10 / 24, 10);
    expect(aggregate.fkpr).toBeCloseTo(2 / 24, 10);
    expect(aggregate.mkpr).toBeCloseTo(4 / 54, 10);
    expect(aggregate.cpr).toBeCloseTo(1 / 24, 10);
    expect(aggregate.totalRounds).toBe(54);
  });
});
