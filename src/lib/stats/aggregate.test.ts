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
  it("preserves real zero and excludes missing source values", () => {
    const aggregate = aggregatePlayerRows([
      row({ kills: null, deaths: null, firstKills: null, rounds: 24 }),
      row({ kills: 0, deaths: 0, firstKills: 0, rounds: 30, ratingPro: 1.2 }),
    ]);

    expect(aggregate.kills).toBe(0);
    expect(aggregate.deaths).toBe(0);
    expect(aggregate.firstKills).toBe(0);
    expect(aggregate.kd).toBeNull();
    expect(aggregate.kpr).toBe(0);
    expect(aggregate.fkpr).toBe(0);
    expect(aggregate.ratingPro).toBeCloseTo(1.2, 10);
    expect(aggregate.totalRounds).toBe(54);
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

  it("returns null for all-missing and zero-denominator metrics", () => {
    const aggregate = aggregatePlayerRows([
      row({ rounds: 0, deaths: 0, kills: null, firstKills: 0, adr: 80, hsPercent: 50 }),
      row({ rounds: null, deaths: null, kills: null, firstKills: null, adr: null, hsPercent: null }),
    ]);

    expect(aggregate.totalRounds).toBe(0);
    expect(aggregate.kills).toBeNull();
    expect(aggregate.deaths).toBe(0);
    expect(aggregate.kd).toBeNull();
    expect(aggregate.kpr).toBeNull();
    expect(aggregate.fkpr).toBeNull();
    expect(aggregate.adr).toBeNull();
    expect(aggregate.hsPercent).toBeNull();
    expect(aggregate.ratingPro).toBeNull();
  });
});
