import { readFileSync } from "node:fs";
import type { Fixture } from "./mizar";

const fixtureWire = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/contracts/mizar-live-snapshot-v1.radar.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

export function mizarSnapshot(f: Fixture, seq = 1, producedAt = new Date().toISOString()) {
  return {
    ...fixtureWire,
    matchId: f.matchId,
    competitionId: f.seasonId,
    format: "bo3",
    producedAt,
    capability: { ...fixtureWire.capability, lineupComplete: true },
    cursor: {
      ...fixtureWire.cursor,
      producerInstanceId: f.producerInstanceId,
      liveSessionId: f.liveSessionId,
      programSourceGeneration: 0,
      mapEpoch: 1,
      runtimeSeq: seq,
    },
    players: Array.from({ length: 10 }, (_, i) => ({
      sourcePlayerId: `source-${i}`,
      canonicalPlayerId: `player-${i}`,
      identityEvidence: "canonical",
      lineupEvidence: "current",
      displayName: `测试选手 ${i}`,
      side: i < 5 ? "CT" : "T",
      lifeState: "alive",
      health: 100,
      armor: 100,
      hasHelmet: true,
      hasDefuser: i < 5,
      money: 3500,
      equipmentValue: 5000,
      activeWeapon: { name: "weapon_ak47", ammoClip: 30, ammoReserve: 90 },
      stats: {
        kills: 10,
        assists: 2,
        deaths: 6,
        liveAdr: 82.5,
        completedAdr: 80,
      },
    })),
    radar: {
      ...fixtureWire.radar,
      players: Array.from({ length: 10 }, (_, i) => ({
        ...fixtureWire.radar.players[0],
        sourcePlayerId: `source-${i}`,
        canonicalPlayerId: `player-${i}`,
        side: i < 5 ? "CT" : "T",
      })),
    },
    roundHistory: {
      mapOrder: 1,
      completeness: "complete",
      rounds: Array.from({ length: 24 }, (_, i) => ({
        roundNumber: i + 1,
        winnerSide: i % 2 ? "T" : "CT",
        winnerEntryId: i % 2 ? f.entryBId : f.entryAId,
        winCondition: "elimination",
      })),
    },
    teams: {
      ct: { entryId: f.entryAId, name: "A" },
      t: { entryId: f.entryBId, name: "B" },
    },
  };
}
