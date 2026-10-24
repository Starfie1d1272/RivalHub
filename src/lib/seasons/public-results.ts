import { withDisplayScores } from "@/lib/matches/display-score-data";
import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionFields } from "@/lib/matches/competition-context";
import "server-only";
import { and, asc, eq, inArray, count, max, or, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, majorFinalResults, majorStageRuns, matches, postEventAdjudications, steamProfiles, tournamentHonors, users } from "@/db/schema";
import { serializePostEventAdjudicationPublic } from "@/lib/postevent/service";
import { loadStageBracketState, serializeStageBracket, resolveFinalBracketNodeId } from "@/lib/bracket";
import { parseMajorFinalPlacementGroups } from "@/lib/major/placement";
import { getManagedMajorProfileFromRunSnapshot } from "@/lib/major/standard";
import { publicCompetitionEntryIdentityCondition } from "@/lib/competition-entries/public-visibility";
import { resolvePublicStagePlan } from "@/lib/seasons/public-stage";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { PublicSeason } from "@/lib/data/public-seasons";

function readFinishedResultMatches(condition: SQL) {
  return db.select({ id: matches.id, seasonId: matches.seasonId, entryAId: matches.entryAId, entryBId: matches.entryBId,
      stage: matches.stage, ownership: matches.ownership, majorStageRunId: matches.majorStageRunId,
      entryRound: matches.entryRound, bracketNodeId: matches.bracketNodeId, format: matches.format,
      scoreA: matches.scoreA, scoreB: matches.scoreB, status: matches.status, isForfeit: matches.isForfeit,
      resultDisposition: matches.resultDisposition, completedAt: matches.completedAt,
    }).from(matches).where(and(officialMatchCondition(), condition, eq(matches.status, "finished"))).orderBy(asc(matches.completedAt));
}

/** Shared fact selection keeps directory and full results on the same champion rules. */
async function readResultFacts(seasonList: readonly PublicSeason[], compact: boolean) {
  const ids = seasonList.map(season => season.id);
  const majorIds = seasonList.filter(season => season.competitionTemplate === "major").map(season => season.id);
  const [results, honorRows, entries, fullMatchRows, runs, adjudicationRows, matchSummaries] = await Promise.all([
    db.query.majorFinalResults.findMany({ where: inArray(majorFinalResults.seasonId, ids) }),
    db.select({ seasonId: tournamentHonors.seasonId, id: tournamentHonors.id, label: tournamentHonors.label, type: tournamentHonors.type, state: tournamentHonors.state, entryId: tournamentHonors.entryId, userId: tournamentHonors.userId, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName })
      .from(tournamentHonors).leftJoin(users, eq(users.id, tournamentHonors.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(and(inArray(tournamentHonors.seasonId, ids), compact ? eq(tournamentHonors.type, "champion") : undefined)),
    db.select({ seasonId: competitionEntries.competitionId, id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(and(inArray(competitionEntries.competitionId, ids), publicCompetitionEntryIdentityCondition())),
    compact ? Promise.resolve([]) : readFinishedResultMatches(inArray(matches.seasonId, ids)),
    majorIds.length ? db.select({ seasonId: majorStageRuns.seasonId, id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, ruleSnapshot: majorStageRuns.ruleSnapshot }).from(majorStageRuns).where(inArray(majorStageRuns.seasonId, majorIds)) : [],
    compact ? Promise.resolve([]) : db.select({
      id: postEventAdjudications.id, seasonId: postEventAdjudications.seasonId,
      status: postEventAdjudications.status, kind: postEventAdjudications.kind, target: postEventAdjudications.target,
      impacts: postEventAdjudications.impacts, targetEntryId: postEventAdjudications.targetEntryId,
      targetUserId: postEventAdjudications.targetUserId, targetMatchId: postEventAdjudications.targetMatchId,
      publicExplanation: postEventAdjudications.publicExplanation, createdAt: postEventAdjudications.createdAt,
      revokedAt: postEventAdjudications.revokedAt,
    }).from(postEventAdjudications).where(inArray(postEventAdjudications.seasonId, ids)).orderBy(asc(postEventAdjudications.createdAt), asc(postEventAdjudications.id)),
    compact ? db.select({ seasonId: matches.seasonId, finishedMatches: count(), completedAt: max(matches.completedAt) })
      .from(matches).where(and(officialMatchCondition(), inArray(matches.seasonId, ids), eq(matches.status, "finished"))).groupBy(matches.seasonId) : Promise.resolve([]),
  ]);
  const finalScopes = compact ? seasonList.flatMap(season => {
    const lastStage = resolvePublicStagePlan(season, runs.filter(run => run.seasonId === season.id)).at(-1);
    return lastStage ? [and(eq(matches.seasonId, season.id), eq(matches.stage, lastStage.key),
      season.competitionTemplate === "major" ? eq(matches.entryRound, "final") : undefined)!] : [];
  }) : [];
  const rawMatchRows = compact ? finalScopes.length ? await readFinishedResultMatches(or(...finalScopes)!) : [] : fullMatchRows;
  return { results, honorRows, entries, rawMatchRows, runs, adjudicationRows, matchSummaries };
}

/** Historical output uses actual completed matches and explicit final/honor facts. */
export async function getPublicSeasonResults(season: PublicSeason) {
  return projectSeasonResults(season, await readResultFacts([season], false));
}

async function projectSeasonResults(season: PublicSeason, facts: Awaited<ReturnType<typeof readResultFacts>>, compact = false) {
  const result = facts.results.find(row => row.seasonId === season.id);
  const honorRows = facts.honorRows.filter(row => row.seasonId === season.id);
  const entries = facts.entries.filter(row => row.seasonId === season.id);
  const rawMatchRows = facts.rawMatchRows.filter(row => row.seasonId === season.id);
  const runs = facts.runs.filter(row => row.seasonId === season.id);
  const adjudicationRows = facts.adjudicationRows.filter(row => row.seasonId === season.id);
  const matchRows = rawMatchRows.map(requireCompetitionFields);
  const names = new Map(entries.map((entry) => [entry.id, entry.name]));
  const stages = resolvePublicStagePlan(season, runs);
  const lastStage = stages.at(-1);
  const bracket = lastStage && season.competitionTemplate !== "major" ? await loadStageBracketState(db, season.id, lastStage.key) : null;
  const finalNode = bracket ? resolveFinalBracketNodeId(serializeStageBracket(bracket)) : null;
  const finals = lastStage ? matchRows.filter((match) => match.stage === lastStage.key && (season.competitionTemplate === "major" ? match.entryRound === "final" && match.ownership === "major_stage" && (!result || match.majorStageRunId === result.playoffStageRunId) : finalNode !== null && match.bracketNodeId === String(finalNode))) : [];
  const final = finals.length === 1 ? finals[0] : null;
  const [displayFinal] = await withDisplayScores(final ? [final] : []);
  const confirmed = result?.status === "confirmed";
  const championHonor = honorRows.filter((honor) => honor.type === "champion");
  const validChampion = championHonor.filter((honor) => honor.state === "valid");
  // An explicit revoked/vacant honor never silently promotes another recipient.
  const championId = championHonor.length ? (validChampion.length === 1 ? validChampion[0].entryId : null)
    : confirmed ? result.championEntryId
    : season.competitionTemplate !== "major" && final && final.scoreA !== null && final.scoreB !== null && final.scoreA !== final.scoreB
      ? final.scoreA > final.scoreB ? final.entryAId : final.entryBId : null;
  const finalResultRun = result ? runs.find((run) => run.id === result.playoffStageRunId) : null;
  const finalResultProfile = !compact && confirmed && finalResultRun
    ? getManagedMajorProfileFromRunSnapshot(finalResultRun.ruleSnapshot, finalResultRun.stageKey)
    : null;
  const placements = compact ? [] : confirmed ? parseMajorFinalPlacementGroups(result.placementGroups, result.championEntryId, finalResultProfile!.entrantCapacity).flatMap((group) => group.entryIds.map((entryId) => ({ entryId, name: names.get(entryId) ?? "队伍", label: group.from === group.to ? `第 ${group.from} 名` : `第 ${group.from}–${group.to} 名` }))) : season.competitionTemplate !== "major" && final && final.scoreA !== null && final.scoreB !== null && final.scoreA !== final.scoreB
    ? (final.scoreA > final.scoreB ? [final.entryAId, final.entryBId] : [final.entryBId, final.entryAId]).map((entryId, index) => ({ entryId, name: names.get(entryId) ?? "队伍", label: `第 ${index + 1} 名` }))
    : [];
  return {
    adjudications: adjudicationRows.map((row) => ({ ...serializePostEventAdjudicationPublic(row), targetName: row.targetEntryId ? names.get(row.targetEntryId) ?? "队伍" : null })),
    champion: championId && names.has(championId) ? { entryId: championId, name: names.get(championId)! } : null,
    championVacant: validChampion.length === 0 && championHonor.some((honor) => honor.state !== "valid"),
    final: final ? { id: final.id, teamA: names.get(final.entryAId) ?? "待定", teamB: names.get(final.entryBId) ?? "待定", scoreA: displayFinal.displayScore.scoreA, scoreB: displayFinal.displayScore.scoreB } : null,
    placements: placements.filter((entry) => names.has(entry.entryId)),
    honors: honorRows.filter((honor) => honor.state === "valid" && (honor.entryId ? names.has(honor.entryId) : honor.userId !== null)).map((honor) => ({ id: honor.id, label: honor.label, entryId: honor.entryId, userId: honor.userId, name: honor.entryId ? names.get(honor.entryId) ?? "队伍" : getPublicDisplayName(honor) })),
    honorHistory: honorRows.filter((honor) => honor.state !== "valid").map((honor) => ({ id: honor.id, label: honor.label, state: honor.state, entryId: honor.entryId, userId: honor.userId, name: honor.entryId ? names.get(honor.entryId) ?? "队伍" : honor.userId ? getPublicDisplayName(honor) : null })),
    completedAt: compact ? facts.matchSummaries.find(row => row.seasonId === season.id)?.completedAt ?? null : matchRows.filter((match) => match.completedAt !== null).at(-1)?.completedAt ?? null,
    finishedMatches: compact ? Number(facts.matchSummaries.find(row => row.seasonId === season.id)?.finishedMatches ?? 0) : matchRows.length,
  };
}
export type PublicSeasonResults = Awaited<ReturnType<typeof getPublicSeasonResults>>;

export type PublicSeasonResultSummary = Pick<PublicSeasonResults, "champion" | "championVacant" | "final" | "completedAt" | "finishedMatches">;

/** Caller bounds the displayed directory page; all events share the fact queries. */
export async function getPublicSeasonResultSummaries(seasonList: readonly PublicSeason[]): Promise<Map<string, PublicSeasonResultSummary>> {
  if (!seasonList.length) return new Map();
  const facts = await readResultFacts(seasonList, true);
  const summaries = new Map<string, PublicSeasonResultSummary>();
  // Provider projections and final display-score reads stay bounded without a checkout burst per card.
  for (const season of seasonList) {
    const { champion, championVacant, final, completedAt, finishedMatches } = await projectSeasonResults(season, facts, true);
    summaries.set(season.id, { champion, championVacant, final, completedAt, finishedMatches });
  }
  return summaries;
}
