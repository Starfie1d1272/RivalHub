import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { PUBLIC_STATS_TAG, broadcastStatsMatchTag, seasonMatchesTag, seasonParticipantsTag } from "@/lib/cache/tags";
import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, matchMaps, matches } from "@/db/schema";
import { isCompetitionMatch } from "@/lib/matches/competition-context";
import { officialMatchCondition } from "@/lib/matches/scope";
import { getCurrentStatsSelectionInTx, getBroadcastPerformanceInTx } from "@/lib/stats/tournament-query";
import { getStatsLeaderboard } from "@/lib/stats/leaderboard-query";
import { getPlayerAttributeBenchmark } from "@/lib/stats/player-attribute-benchmark";
import { projectPlayerAttributeProfile } from "@/lib/stats/player-attributes";
import { buildTournamentResults } from "@/lib/stats/results";
import { AppError, ErrorCode } from "@/lib/errors";
import { broadcastStatsCutoff, playerStatsAvailable } from "./stats-scope";
import { documentRevision, loadMizarMatchDocumentInTx } from "./context";
import type { BroadcastStatsBundle, BroadcastStatsEntrant } from "./stats-contract";

export async function loadBroadcastStats(matchId: string, competitionId: string): Promise<BroadcastStatsBundle> {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  cacheTag(PUBLIC_STATS_TAG, broadcastStatsMatchTag(matchId), seasonMatchesTag(competitionId), seasonParticipantsTag(competitionId));
  const generatedAt = new Date();
  const snapshot = await db.transaction(async tx => {
    const document = await loadMizarMatchDocumentInTx(tx, matchId, competitionId);
    const startedAt = document.match.startedAt ? new Date(document.match.startedAt) : null;
    const scheduledAt = document.match.scheduledAt ? new Date(document.match.scheduledAt) : null;
    const { cutoffAt, cutoffSource } = broadcastStatsCutoff(startedAt, scheduledAt, generatedAt);
    const history = (await tx.select().from(matches).where(and(eq(matches.seasonId, competitionId), officialMatchCondition(), eq(matches.status, "finished"), lt(matches.completedAt, cutoffAt), ne(matches.id, matchId))).orderBy(asc(matches.id)).limit(1001)).filter(isCompetitionMatch);
    if (history.length > 1000) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事统计范围过大。");
    const ids = history.map(row => row.id);
    const maps = ids.length ? await tx.select().from(matchMaps).where(and(inArray(matchMaps.matchId, ids), lt(matchMaps.completedAt, cutoffAt))).orderBy(asc(matchMaps.id)) : [];
    const entries = await tx.select({ id: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl }).from(competitionEntries).where(eq(competitionEntries.competitionId, competitionId));
    const results = buildTournamentResults(history, maps, entries);
    const selection = await getCurrentStatsSelectionInTx(tx, { seasonId: competitionId, before: cutoffAt, excludeMatchId: matchId });
    const detail = await getBroadcastPerformanceInTx(tx, competitionId, ids);
    const scoreboard = await getStatsLeaderboard({ seasonId: competitionId, matchIds: selection.matchIds }, selection.currentImportIds, selection.roster, tx, { groupByTeam: false, requireRosterMatch: true });
    const historyById = new Map(history.map(row => [row.id, row]));
    const entryById = new Map(entries.map(row => [row.id, row]));
    const entrants: BroadcastStatsEntrant[] = [document.entrants.a, document.entrants.b].map(entry => {
      const starters = entry.roster.players.filter(player => player.isStarter).map(player => ({ userId: player.playerId, nickname: player.displayName, avatarUrl: player.avatarUrl }));
      const mapStats = document.match.mapPool.map(mapName => {
        const row = results.teamMaps.find(row => row.mapName === mapName)?.teams.find(row => row.entryId === entry.entryId);
        return { mapName, played: row?.played ?? 0, wins: row?.wins ?? 0, winRate: row?.played ? row.wins / row.played : null };
      });
      const recent = maps.flatMap(map => {
        const match = historyById.get(map.matchId);
        if (!match || !map.completedAt || map.scoreA === null || map.scoreB === null || ![match.entryAId, match.entryBId].includes(entry.entryId)) return [];
        const sideA = match.entryAId === entry.entryId;
        const opponent = entryById.get(sideA ? match.entryBId : match.entryAId);
        if (!opponent) return [];
        return [{ matchId: match.id, mapId: map.id, mapName: map.mapName, completedAt: map.completedAt.toISOString(), opponent: { entryId: opponent.id, name: opponent.name, logoUrl: opponent.logoUrl }, score: sideA ? map.scoreA : map.scoreB, opponentScore: sideA ? map.scoreB : map.scoreA }];
      }).sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.mapId.localeCompare(a.mapId)).slice(0, 5).map(({ mapId: _mapId, ...row }) => { void _mapId; return row; });
      const players: BroadcastStatsEntrant["playerPerformance"]["players"] = starters.map(starter => {
        const row = scoreboard.find(row => row.userId === starter.userId);
        const available = playerStatsAvailable(row);
        return { userId: starter.userId, available, sample: { maps: row?.maps ?? 0, rounds: row?.rounds ?? null, ratingMaps: row?.ratingSamples ?? 0, adrRounds: row?.adrRounds ?? null }, rating: row?.avgRating ?? null, adr: row?.avgAdr ?? null, attributes: { available: false, benchmark: "rivalhub-all-time-qualified", scope: "competition-before-match", sample: { rounds: 0 }, values: [] } };
      });
      const team = detail.analytics.teams.find(row => row.team.entityKey === entry.entryId);
      const utility = detail.performance.teams.find(row => row.team.entityKey === entry.entryId)?.slices.overall.utility;
      const completedMaps = results.teams.find(row => row.entryId === entry.entryId)?.maps ?? 0;
      const coverage = { completedMaps, detailedMaps: detail.detailedMapsByTeam[entry.entryId] ?? 0 };
      const winValid = (value: { opportunities: number; rate: number | null } | undefined) => !!value && value.opportunities > 0 && value.rate !== null && Number.isFinite(value.rate);
      const quantityValid = (value: { attempts: number; rate: number | null } | undefined) => !!value && value.attempts > 0 && value.rate !== null && Number.isFinite(value.rate);
      const covered = coverage.completedMaps > 0 && coverage.detailedMaps === coverage.completedMaps;
      const scope = "competition-before-match" as const;
      return { entryId: entry.entryId, name: entry.name, logoUrl: entry.logoUrl, starters,
        mapPerformance: { available: mapStats.some(row => row.played > 0), maps: mapStats },
        recentResults: { available: recent.length > 0, granularity: "map", results: recent },
        playerPerformance: { available: players.some(row => row.available), players },
        pistol: { scope, coverage, available: covered && winValid(team?.pistol), pistol: team?.pistol ?? null, conversion: team?.round2.conversion ?? null, break: team?.round2.break ?? null },
        economy: { scope, coverage, available: covered && winValid(team?.ecoSemiUpset), ecoSemiUpset: team?.ecoSemiUpset ?? null },
        utility: { scope, coverage, available: covered && quantityValid(utility?.utilityDamagePerRound) && quantityValid(utility?.flashAssistsPerRound), utilityDamagePerRound: utility?.utilityDamagePerRound ?? null, flashAssistsPerRound: utility?.flashAssistsPerRound ?? null, enemyBlindSecondsPerFlash: utility?.enemyBlindSecondsPerFlash ?? null, enemyBlindSecondsPerRound: utility?.enemyBlindSecondsPerRound ?? null },
      };
    });
    const payload = { schemaVersion: "rivalhub.broadcast-stats.v1" as const, matchId, competitionId, scope: { kind: "competition-before-match" as const, cutoffAt: cutoffAt.toISOString(), cutoffSource }, entrants };
    return { payload, performance: detail.performance.players };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (snapshot.performance.length) {
    const benchmark = await getPlayerAttributeBenchmark();
    for (const entrant of snapshot.payload.entrants) for (const player of entrant.playerPerformance.players) {
      const performance = snapshot.performance.find(row => row.player.entityKey === player.userId);
      if (!performance) continue;
      const values = projectPlayerAttributeProfile(performance, benchmark).attributes.map(({ key, score, status }) => ({ key, score, status }));
      player.attributes = { available: values.length === 7 && new Set(values.map(value => value.key)).size === 7 && values.every(value => value.score !== null && Number.isFinite(value.score) && value.status === "qualified"), benchmark: "rivalhub-all-time-qualified", scope: "competition-before-match", sample: { rounds: performance.slices.overall.sample.rounds }, values };
    }
  }
  return { ...snapshot.payload, generatedAt: generatedAt.toISOString(), revision: documentRevision(snapshot.payload) };
}
