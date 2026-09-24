import { describe, expect, it } from "vitest";
import type { TournamentPerformancePlayerSummary } from "@cs2dak/tournament";
import { buildPlayerAttributeProfile } from "./player-attributes";

type PlayerOptions = {
  id: string;
  rounds?: number;
  kills?: number;
  damagePerRound?: number;
  multiKillRounds?: number;
  deaths?: number;
  tradedDeaths?: number;
  firstKills?: number;
  firstDeaths?: number;
  tradedOpeningDeaths?: number;
  tradeKills?: number;
  clutchAttempts?: number;
  clutchWins?: number;
  awpKills?: number;
  grenadeThrows?: number;
  utilityDamagePerRound?: number;
  flashAssists?: number;
};

function rate(successes: number, attempts: number) {
  return { successes, attempts, rate: attempts > 0 ? successes / attempts : null };
}

function makePlayer(options: PlayerOptions): TournamentPerformancePlayerSummary {
  const rounds = options.rounds ?? 100;
  const kills = options.kills ?? 70;
  const deaths = options.deaths ?? 65;
  const firstKills = options.firstKills ?? 10;
  const firstDeaths = options.firstDeaths ?? 10;
  const tradeKills = options.tradeKills ?? 14;
  const tradedDeaths = options.tradedDeaths ?? 13;
  const clutchAttempts = options.clutchAttempts ?? 10;
  const clutchWins = options.clutchWins ?? 2;
  const awpKills = options.awpKills ?? 10;
  const grenadeThrows = options.grenadeThrows ?? 160;
  const utilityDamagePerRound = options.utilityDamagePerRound ?? 4;
  const flashAssists = options.flashAssists ?? 3;
  const multiKillRounds = options.multiKillRounds ?? 18;

  return {
    player: { entityKey: options.id, displayName: options.id },
    teamEntityKeys: ["team-a"],
    matchCount: 5,
    mapCount: 5,
    weapons: [
      {
        weapon: "awp",
        kills: awpKills,
        headshotKills: 0,
        headshotRate: rate(0, awpKills),
        killShare: rate(awpKills, kills),
        killsPerRound: rate(awpKills, rounds),
        teamEntityKeys: ["team-a"],
      },
      {
        weapon: "ak47",
        kills: Math.max(0, kills - awpKills),
        headshotKills: 0,
        headshotRate: rate(0, Math.max(0, kills - awpKills)),
        killShare: rate(Math.max(0, kills - awpKills), kills),
        killsPerRound: rate(Math.max(0, kills - awpKills), rounds),
        teamEntityKeys: ["team-a"],
      },
    ],
    slices: {
      overall: {
        sample: { rounds },
        combat: {
          kills,
          deaths,
          assists: 20,
          damage: (options.damagePerRound ?? 75) * rounds,
          headshots: 20,
          killsPerRound: rate(kills, rounds),
          deathsPerRound: rate(deaths, rounds),
          assistsPerRound: rate(20, rounds),
          damagePerRound: rate((options.damagePerRound ?? 75) * rounds, rounds),
          headshotRate: rate(20, kills),
          twoKillRounds: multiKillRounds,
          threeKillRounds: 0,
          fourKillRounds: 0,
          fiveKillRounds: 0,
        },
        kast: rate(75, rounds),
        survival: rate(Math.max(0, rounds - deaths), rounds),
        opening: {
          firstKills,
          firstDeaths,
          attempts: firstKills + firstDeaths,
          successRate: rate(firstKills, firstKills + firstDeaths),
          attemptRate: rate(firstKills + firstDeaths, rounds),
          firstKillsPerRound: rate(firstKills, rounds),
          firstDeathsPerRound: rate(firstDeaths, rounds),
          roundWinsAfterWinningOpeningDuel: 7,
          winRateAfterWinningOpeningDuel: rate(7, firstKills),
          roundWinsAfterLosingOpeningDuel: 3,
          comebackRateAfterLosingOpeningDuel: rate(3, firstDeaths),
        },
        trade: {
          tradeKills,
          tradedDeaths,
          tradedOpeningDeaths: options.tradedOpeningDeaths ?? 3,
          deaths,
          tradeKillsPerRound: rate(tradeKills, rounds),
          tradedDeathsPerDeath: rate(tradedDeaths, deaths),
        },
        clutch: {
          attempts: clutchAttempts,
          wins: clutchWins,
          winRate: rate(clutchWins, clutchAttempts),
          frequency: rate(clutchAttempts, rounds),
          byOpponentCount: {
            "1": rate(0, 0),
            "2": rate(0, 0),
            "3": rate(0, 0),
            "4": rate(0, 0),
            "5": rate(0, 0),
          },
        },
        utility: {
          flashesThrown: Math.round(grenadeThrows * 0.4),
          enemyBlindSeconds: 20,
          teamBlindSeconds: 5,
          netBlindSeconds: 15,
          enemyBlindVictims: 10,
          flashAssists,
          heThrows: Math.round(grenadeThrows * 0.2),
          heDamage: utilityDamagePerRound * rounds * 0.55,
          fireThrows: Math.round(grenadeThrows * 0.15),
          fireDamage: utilityDamagePerRound * rounds * 0.45,
          smokesThrown: Math.round(grenadeThrows * 0.25),
          utilityKills: 1,
          utilityDamage: utilityDamagePerRound * rounds,
          enemyBlindSecondsPerFlash: rate(20, Math.round(grenadeThrows * 0.4)),
          netBlindSecondsPerFlash: rate(15, Math.round(grenadeThrows * 0.4)),
          enemyBlindSecondsPerRound: rate(20, rounds),
          teamBlindSecondsPerRound: rate(5, rounds),
          flashAssistsPerRound: rate(flashAssists, rounds),
          heDamagePerThrow: rate(utilityDamagePerRound * rounds * 0.55, Math.round(grenadeThrows * 0.2)),
          heDamagePerRound: rate(utilityDamagePerRound * rounds * 0.55, rounds),
          fireDamagePerThrow: rate(utilityDamagePerRound * rounds * 0.45, Math.round(grenadeThrows * 0.15)),
          fireDamagePerRound: rate(utilityDamagePerRound * rounds * 0.45, rounds),
          smokesPerRound: rate(Math.round(grenadeThrows * 0.25), rounds),
          utilityKillsPerRound: rate(1, rounds),
          utilityDamagePerRound: rate(utilityDamagePerRound * rounds, rounds),
        },
        objective: {
          plants: 0,
          defuses: 0,
          plantsConverted: 0,
          plantConversions: rate(0, 0),
        },
      },
      t: {} as never,
      ct: {} as never,
    },
  };
}

function population() {
  return [
    makePlayer({ id: "p1", rounds: 100, kills: 55, damagePerRound: 62, awpKills: 0 }),
    makePlayer({ id: "p2", rounds: 120, kills: 68, damagePerRound: 72, awpKills: 4 }),
    makePlayer({ id: "p3", rounds: 140, kills: 90, damagePerRound: 84, awpKills: 18 }),
    makePlayer({ id: "p4", rounds: 160, kills: 120, damagePerRound: 96, awpKills: 45 }),
  ];
}

describe("player attributes", () => {
  it("lets limited samples receive scores without entering official ranking", () => {
    const target = makePlayer({
      id: "limited",
      rounds: 10,
      kills: 9,
      damagePerRound: 95,
      firstKills: 1,
      firstDeaths: 1,
      clutchAttempts: 1,
      clutchWins: 1,
    });

    const profile = buildPlayerAttributeProfile(target, population());
    const firepower = profile.attributes.find((row) => row.key === "firepower")!;

    expect(firepower.score).not.toBeNull();
    expect(firepower.status).toBe("limited");
    expect(firepower.rank).toBeNull();
  });

  it("treats zero sniper usage as a true zero score", () => {
    const target = makePlayer({ id: "rifler", rounds: 120, kills: 80, awpKills: 0 });
    const profile = buildPlayerAttributeProfile(target, population());
    const sniping = profile.attributes.find((row) => row.key === "sniping")!;

    expect(sniping.score).toBe(0);
    expect(sniping.status).toBe("qualified");
  });

  it("gives qualified samples an official attribute rank", () => {
    const target = makePlayer({ id: "qualified", rounds: 140, kills: 95, damagePerRound: 88, awpKills: 20 });
    const profile = buildPlayerAttributeProfile(target, population());
    const firepower = profile.attributes.find((row) => row.key === "firepower")!;

    expect(firepower.status).toBe("qualified");
    expect(firepower.rank).not.toBeNull();
    expect(firepower.rankedCount).toBeGreaterThan(0);
  });
});
