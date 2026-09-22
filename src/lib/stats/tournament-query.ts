import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { db, type DB } from "@/db/client";
import { competitionEntries, matchDemoImports, matchMaps, matches, matchVetoSteps, steamProfiles, users } from "@/db/schema";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { resolveGameplayUsersBySteam64 } from "@/lib/identity/gameplay-steam";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { getStatsLeaderboard } from "./leaderboard-query";
import { adaptStatsEvidence, type StatsPlayerBinding } from "./evidence-adapter";

export interface TournamentStatsScope { seasonId: string; stage?: string; map?: string; team?: string }

export async function getTournamentStats(scope: TournamentStatsScope, database: DB = db) {
  return database.transaction(async (tx) => {
    const matchRows = await tx.select().from(matches).where(and(eq(matches.seasonId, scope.seasonId), scope.stage ? eq(matches.stage, scope.stage) : undefined));
    const scopedMatches = matchRows.filter((match) => match.status !== "cancelled" && (!scope.team || [match.entryAId, match.entryBId].includes(scope.team)));
    const matchIds = scopedMatches.map((match) => match.id);
    const entries = await tx.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(eq(competitionEntries.competitionId, scope.seasonId));
    const maps = matchIds.length ? await tx.select().from(matchMaps).where(inArray(matchMaps.matchId, matchIds)) : [];
    const scopedMaps = maps.filter((map) => !scope.map || map.mapName === scope.map);
    const imports = scopedMaps.length ? await tx.select().from(matchDemoImports).where(inArray(matchDemoImports.matchMapId, scopedMaps.map((map) => map.id))).orderBy(desc(matchDemoImports.createdAt), desc(matchDemoImports.id)) : [];
    const roster = await loadEffectiveMatchRoster(tx, matchIds);
    const selected = scopedMaps.flatMap((map) => {
      const candidates = imports.filter((row) => row.matchMapId === map.id);
      const current = selectCurrentDemoImport(candidates);
      const match = scopedMatches.find((row) => row.id === map.matchId)!;
      if (!current || current.status !== "confirmed" || match.status !== "finished" || !map.completedAt || map.scoreA === null || map.scoreB === null) return [];
      if (current.evidenceRevision !== buildEvidenceRevisionForTarget({ match, map, roster: roster.filter((row) => row.matchId === match.id) })) return [];
      const evidence = parseRivalHubDemoEvidenceV1(current.payload);
      if (evidence.target.matchMapId !== map.id || evidence.target.matchId !== match.id || evidence.target.seasonId !== scope.seasonId || evidence.contract.semanticProfile !== current.semanticProfile) throw new Error("Stats evidence target mismatch");
      return [{ evidence, match, map, importId: current.id }];
    });
    const resolutions = await resolveGameplayUsersBySteam64(tx, selected.flatMap(({ evidence }) => evidence.participants.map((participant) => participant.steamId64)));
    const facts = selected.map(({ evidence, match }) => {
      const bindings = new Map<string, StatsPlayerBinding>();
      for (const participant of evidence.participants) {
        const resolution = resolutions.get(participant.steamId64);
        const member = roster.find((row) => row.matchId === match.id && row.userId === resolution?.userId);
        if (!resolution || !member) throw new Error("Stats evidence identity unavailable");
        bindings.set(participant.steamId64, { userId: resolution.userId, entryId: member.entryId });
      }
      return adaptStatsEvidence(evidence, bindings);
    });
    const userIds = [...new Set([...resolutions.values()].map((row) => row.userId))];
    const identities = userIds.length ? await tx.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName })
      .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(users.id, userIds)) : [];
    const labels = { teams: Object.fromEntries(entries.map((entry) => [entry.id, entry.name])), players: Object.fromEntries(identities.map((user) => [user.id, getPublicDisplayName(user)])) };
    const veto = matchIds.length ? await tx.select({ mapName: matchVetoSteps.mapName, action: matchVetoSteps.actionType, entryId: matchVetoSteps.entryId }).from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, matchIds)) : [];
    const selection = [...new Set(veto.map((row) => row.mapName))].filter((name) => !scope.map || name === scope.map).sort().map((mapName) => {
      const rows = veto.filter((row) => row.mapName === mapName);
      return { mapName, picks: rows.filter((row) => row.action === "pick").length, bans: rows.filter((row) => row.action === "ban").length, deciders: rows.filter((row) => row.action === "decider").length,
        teams: entries.map((entry) => ({ entryId: entry.id, name: entry.name, picks: rows.filter((row) => row.entryId === entry.id && row.action === "pick").length, bans: rows.filter((row) => row.entryId === entry.id && row.action === "ban").length })).filter((row) => row.picks || row.bans) };
    });
    return {
      leaderboard: await getStatsLeaderboard(scope.seasonId, scope.stage ?? "", scope.map ?? "", scope.team ?? "", selected.map((row) => row.importId), roster, tx),
      analytics: buildTournamentAnalytics(facts.map((fact) => fact.tournament), { labels }),
      performance: buildTournamentPerformanceAnalytics(facts.map((fact) => fact.performance), { labels }),
      selection,
      coverage: { confirmedMaps: selected.length, completedMaps: scopedMaps.filter((map) => map.completedAt !== null && map.scoreA !== null && map.scoreB !== null).length },
      options: { teams: entries, maps: [...new Set([...maps.map((map) => map.mapName), ...veto.map((row) => row.mapName)])].sort() },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type TournamentStats = Awaited<ReturnType<typeof getTournamentStats>>;
