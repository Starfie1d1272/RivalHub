import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries } from "@/db/schema";
import { readMatchSupport } from "@/lib/bet/match-support";
import { openingDeathTraded } from "@/lib/stats/derived-metrics";
import { getTournamentTeamDetailInTx } from "@/lib/stats/tournament-query";
import { getPlayerAttributeBenchmark } from "@/lib/stats/player-attribute-benchmark";
import { projectPlayerAttributeProfile } from "@/lib/stats/player-attributes";
import { broadcastMatchSupport } from "./stats-support";
import { playerStatsAvailable } from "./stats-scope";
import { documentRevision, loadMizarMatchDocumentInTx } from "./context";
import type { BroadcastStatsBundle, BroadcastStatsEntrant } from "./stats-contract";

export async function loadBroadcastStats(matchId: string, competitionId: string): Promise<BroadcastStatsBundle> {
  const generatedAt = new Date().toISOString();
  const { document, entries, details, opponents, supportRows } = await db.transaction(async tx => {
    const document = await loadMizarMatchDocumentInTx(tx, matchId, competitionId, true);
    const entries = [document.entrants.a, document.entrants.b];
    const details = [];
    for (const entry of entries) details.push(await getTournamentTeamDetailInTx({ seasonId: competitionId, teamId: entry.entryId }, tx));
    const opponentIds = [...new Set(details.flatMap(detail => detail.official.matches.flatMap(match => [match.entryAId, match.entryBId])))];
    const opponents = opponentIds.length ? await tx.select({ id: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl }).from(competitionEntries).where(inArray(competitionEntries.id, opponentIds)) : [];
    const supportRows = await readMatchSupport(tx, competitionId, matchId);
    return { document, entries, details, opponents, supportRows };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
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
    const rounds = (value: typeof team) => value ? { wins: value.roundWins, rounds: value.rounds, rate: value.roundWinRate, ct: value.ct, t: value.t } : null;
    const series = detail.official.matches.flatMap(match => {
      if (match.status !== "finished" || match.scoreA === null || match.scoreB === null) return [];
      const sideA = match.entryAId === entry.entryId;
      const opponent = opponentById.get(sideA ? match.entryBId : match.entryAId);
      if (!opponent) return [];
      return [{ matchId: match.id, stage: match.stage, round: match.round, completedAt: match.completedAt?.toISOString() ?? null, opponent: { entryId: opponent.id, name: opponent.name, logoUrl: opponent.logoUrl }, score: sideA ? match.scoreA : match.scoreB, opponentScore: sideA ? match.scoreB : match.scoreA,
        maps: detail.official.maps.filter(map => map.matchId === match.id).map(map => ({ mapName: map.mapName, completedAt: map.completedAt?.toISOString() ?? null, score: sideA ? map.scoreA : map.scoreB, opponentScore: sideA ? map.scoreB : map.scoreA })).sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? "") || a.mapName.localeCompare(b.mapName)) }];
    }).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.matchId.localeCompare(a.matchId));
    const overall = detail.performance?.slices.overall;
    const facts: NonNullable<BroadcastStatsEntrant["facts"]> = {
      source: "competition-canonical", coverage,
      results: detail.results && { matches: detail.results.matches, matchWins: detail.results.matchWins, matchLosses: detail.results.matchLosses, maps: detail.results.maps, mapWins: detail.results.mapWins, mapLosses: detail.results.mapLosses },
      maps: detail.maps.map(map => { const selection = detail.selection.find(row => row.mapName === map.mapName); const selectedTeam = selection?.teams.find(row => row.entryId === entry.entryId); return { mapName: map.mapName, results: map.results && { played: map.results.played, wins: map.results.wins, losses: map.results.losses }, rounds: rounds(map.analytics), selection: selection ? { picks: selectedTeam?.picks ?? 0, bans: selectedTeam?.bans ?? 0, deciders: selection.deciders } : null, coverage: { completedMaps: map.coverage.completedMaps, detailedMaps: map.coverage.detailedMaps } }; }),
      series: { total: series.length, truncated: series.length > 50, matches: series.slice(0, 50) },
      teamRating: detail.teamRating && { rating: detail.teamRating.rating, ratingSamples: detail.teamRating.ratingSamples }, rounds: rounds(team), manAdvantage: team?.manAdvantage ?? null,
      opening: overall ? { successRate: overall.opening.successRate, winAfterOpening: overall.opening.winRateAfterWinningOpeningDuel, tradeKillsPerRound: overall.trade.tradeKillsPerRound, tradedOpeningDeaths: overall.trade.tradedOpeningDeaths, firstDeaths: overall.opening.firstDeaths, openingDeathTraded: openingDeathTraded(overall), comebackRate: overall.opening.comebackRateAfterLosingOpeningDuel } : null,
      utility: overall ? { sample: overall.sample, flashesThrown: overall.utility.flashesThrown, utilityDamagePerRound: overall.utility.utilityDamagePerRound, flashAssistsPerRound: overall.utility.flashAssistsPerRound, utilityKillsPerRound: overall.utility.utilityKillsPerRound, enemyBlindSecondsPerFlash: overall.utility.enemyBlindSecondsPerFlash, enemyBlindSecondsPerRound: overall.utility.enemyBlindSecondsPerRound, teamBlindSecondsPerRound: overall.utility.teamBlindSecondsPerRound } : null,
      plantConversions: overall?.objective.plantConversions ?? null,
      weapons: detail.performance?.weapons.map(({ weapon, kills, killShare, killsPerRound }) => ({ weapon, kills, killShare, killsPerRound })) ?? null,
      players: starters.map(starter => { const row = detail.scoreboard.find(item => item.userId === starter.userId); const slice = detail.detailedPlayers.find(item => item.player.entityKey === starter.userId)?.slices.overall; return { userId: starter.userId, maps: row?.maps ?? 0, ratingMaps: row?.ratingSamples ?? 0, rounds: row?.rounds ?? null, adrRounds: row?.adrRounds ?? null, rating: row?.avgRating ?? null, adr: row?.avgAdr ?? null, kd: row?.kdRatio ?? null, scoreboard: row ? { source: "confirmed-scoreboard", kpr: { value: row.kpr, rounds: row.scoreboardSamples.kprRounds }, fkpr: { value: row.fkpr, rounds: row.scoreboardSamples.fkprRounds }, mkpr: { value: row.mkpr, rounds: row.scoreboardSamples.mkprRounds }, cpr: { value: row.cpr, rounds: row.scoreboardSamples.cprRounds }, fdpr: { value: row.fdpr, rounds: row.scoreboardSamples.fdprRounds }, tradeKpr: { value: row.tradeKpr, rounds: row.scoreboardSamples.tradeKprRounds }, kast: { value: row.kast, rounds: row.scoreboardSamples.kastRounds }, avgHs: { value: row.avgHs, kills: row.scoreboardSamples.hsKills }, kd: { value: row.kdRatio, deaths: row.scoreboardSamples.kdDeaths } } : null, detailed: slice ? { sample: slice.sample, kast: slice.kast, killsPerRound: slice.combat.killsPerRound, headshotRate: slice.combat.headshotRate, twoKillRounds: slice.combat.twoKillRounds, threeKillRounds: slice.combat.threeKillRounds, fourKillRounds: slice.combat.fourKillRounds, fiveKillRounds: slice.combat.fiveKillRounds, openingSuccess: slice.opening.successRate, tradeKillsPerRound: slice.trade.tradeKillsPerRound, clutch: { attempts: slice.clutch.attempts, wins: slice.clutch.wins, winRate: slice.clutch.winRate, byOpponentCount: slice.clutch.byOpponentCount } } : null }; }),
    };
    return { facts, entryId: entry.entryId, name: entry.name, logoUrl: entry.logoUrl, starters,
      mapPerformance: { available: mapStats.some(row => row.played > 0), maps: mapStats },
      recentResults: { available: recent.length > 0, granularity: "map", results: recent },
      playerPerformance: { available: players.some(row => row.available), players },
      pistol: { scope, coverage, available: winValid(team?.pistol), pistol: team?.pistol ?? null, conversion: team?.round2.conversion ?? null, break: team?.round2.break ?? null },
      economy: { scope, coverage, available: winValid(team?.ecoSemiUpset), ecoSemiUpset: team?.ecoSemiUpset ?? null },
      utility: { scope, coverage, available: [utility?.utilityDamagePerRound, utility?.flashAssistsPerRound, utility?.enemyBlindSecondsPerFlash, utility?.enemyBlindSecondsPerRound].some(quantityValid), utilityDamagePerRound: utility?.utilityDamagePerRound ?? null, flashAssistsPerRound: utility?.flashAssistsPerRound ?? null, enemyBlindSecondsPerFlash: utility?.enemyBlindSecondsPerFlash ?? null, enemyBlindSecondsPerRound: utility?.enemyBlindSecondsPerRound ?? null },
    };
  });
  const support = broadcastMatchSupport(supportRows, entries.map(entry => entry.entryId));
  const payload = { mapPool: document.match.mapPool, support, schemaVersion: "rivalhub.broadcast-stats.v1" as const, matchId, competitionId, scope: { kind: "competition" as const }, entrants };
  return { ...payload, generatedAt, revision: documentRevision(payload) };
}
