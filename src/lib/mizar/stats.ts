import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries } from "@/db/schema";
import { getTournamentTeamDetail } from "@/lib/stats/tournament-query";
import { getPlayerAttributeBenchmark } from "@/lib/stats/player-attribute-benchmark";
import { projectPlayerAttributeProfile } from "@/lib/stats/player-attributes";
import { playerStatsAvailable } from "./stats-scope";
import { documentRevision, loadMizarMatchDocument } from "./context";
import type { BroadcastStatsBundle, BroadcastStatsEntrant } from "./stats-contract";

export async function loadBroadcastStats(matchId: string, competitionId: string): Promise<BroadcastStatsBundle> {
  const generatedAt = new Date().toISOString();
  const document = await loadMizarMatchDocument(matchId, competitionId);
  const entries = [document.entrants.a, document.entrants.b];
  const details = await Promise.all(entries.map(entry => getTournamentTeamDetail({ seasonId: competitionId, teamId: entry.entryId })));
  const opponentIds = [...new Set(details.flatMap(detail => detail.official.matches.flatMap(match => [match.entryAId, match.entryBId])))];
  const opponents = opponentIds.length ? await db.select({ id: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl }).from(competitionEntries).where(inArray(competitionEntries.id, opponentIds)) : [];
  const opponentById = new Map(opponents.map(row => [row.id, row]));
  const benchmark = details.some(detail => detail.detailedPlayers.length) ? await getPlayerAttributeBenchmark() : null;
  const winValid = (value: { opportunities: number; rate: number | null } | undefined) => !!value && value.opportunities > 0 && value.rate !== null && Number.isFinite(value.rate);
  const quantityValid = (value: { attempts: number; rate: number | null } | undefined) => !!value && value.attempts > 0 && value.rate !== null && Number.isFinite(value.rate);
  const entrants: BroadcastStatsEntrant[] = entries.map((entry, index) => {
    const detail = details[index];
    const starters = entry.roster.players.filter(player => player.isStarter).map(player => ({ userId: player.playerId, nickname: player.displayName, avatarUrl: player.avatarUrl }));
    const mapStats = detail.maps.flatMap(({ mapName, results }) => results && results.played > 0 ? [{
      mapName, played: results.played, wins: results.wins, winRate: results.wins / results.played,
    }] : []);
    const historyById = new Map(detail.official.matches.filter(match => match.status === "finished").map(match => [match.id, match]));
    const recent = detail.official.maps.flatMap(map => {
      const match = historyById.get(map.matchId);
      if (!match || !map.completedAt || map.scoreA === null || map.scoreB === null) return [];
      const sideA = match.entryAId === entry.entryId;
      const opponent = opponentById.get(sideA ? match.entryBId : match.entryAId);
      if (!opponent) return [];
      return [{ matchId: match.id, mapName: map.mapName, completedAt: map.completedAt.toISOString(), opponent: { entryId: opponent.id, name: opponent.name, logoUrl: opponent.logoUrl }, score: sideA ? map.scoreA : map.scoreB, opponentScore: sideA ? map.scoreB : map.scoreA }];
    }).sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.matchId.localeCompare(a.matchId) || a.mapName.localeCompare(b.mapName)).slice(0, 5);
    const players: BroadcastStatsEntrant["playerPerformance"]["players"] = starters.map(starter => {
      const row = detail.scoreboard.find(row => row.userId === starter.userId);
      const performance = detail.detailedPlayers.find(row => row.player.entityKey === starter.userId);
      const values = performance && benchmark ? projectPlayerAttributeProfile(performance, benchmark).attributes.map(({ key, score, status }) => ({ key, score, status })) : [];
      return { userId: starter.userId, available: playerStatsAvailable(row), sample: { maps: row?.maps ?? 0, rounds: row?.rounds ?? null, ratingMaps: row?.ratingSamples ?? 0, adrRounds: row?.adrRounds ?? null }, rating: row?.avgRating ?? null, adr: row?.avgAdr ?? null,
        attributes: { available: values.length === 7 && new Set(values.map(value => value.key)).size === 7 && values.every(value => value.score !== null && Number.isFinite(value.score) && value.status === "qualified"), benchmark: "rivalhub-all-time-qualified", scope: "competition", sample: { rounds: performance?.slices.overall.sample.rounds ?? 0 }, values } };
    });
    const team = detail.analytics;
    const utility = detail.performance?.slices.overall.utility;
    const coverage = { completedMaps: detail.coverage.completedMaps, detailedMaps: detail.coverage.detailedMaps };
    const scope = "competition" as const;
    return { entryId: entry.entryId, name: entry.name, logoUrl: entry.logoUrl, starters,
      mapPerformance: { available: mapStats.some(row => row.played > 0), maps: mapStats },
      recentResults: { available: recent.length > 0, granularity: "map", results: recent },
      playerPerformance: { available: players.some(row => row.available), players },
      pistol: { scope, coverage, available: winValid(team?.pistol), pistol: team?.pistol ?? null, conversion: team?.round2.conversion ?? null, break: team?.round2.break ?? null },
      economy: { scope, coverage, available: winValid(team?.ecoSemiUpset), ecoSemiUpset: team?.ecoSemiUpset ?? null },
      utility: { scope, coverage, available: [utility?.utilityDamagePerRound, utility?.flashAssistsPerRound, utility?.enemyBlindSecondsPerFlash, utility?.enemyBlindSecondsPerRound].some(quantityValid), utilityDamagePerRound: utility?.utilityDamagePerRound ?? null, flashAssistsPerRound: utility?.flashAssistsPerRound ?? null, enemyBlindSecondsPerFlash: utility?.enemyBlindSecondsPerFlash ?? null, enemyBlindSecondsPerRound: utility?.enemyBlindSecondsPerRound ?? null },
    };
  });
  const payload = { schemaVersion: "rivalhub.broadcast-stats.v1" as const, matchId, competitionId, scope: { kind: "competition" as const }, entrants };
  return { ...payload, generatedAt, revision: documentRevision(payload) };
}
