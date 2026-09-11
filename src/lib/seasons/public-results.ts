import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, majorFinalResults, majorStageRuns, matches, tournamentHonors, users } from "@/db/schema";
import { loadStageBracketViews, resolveFinalBracketNodeId } from "@/lib/bracket";
import { parseMajorFinalPlacementGroups } from "@/lib/major/placement";
import { resolveMajorStagePlan } from "@/lib/major/run-snapshot";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { PublicSeason } from "@/lib/data/public-seasons";

/** Historical output uses actual completed matches and explicit final/honor facts. */
export async function getPublicSeasonResults(season: PublicSeason) {
  const [result, honorRows, entries, matchRows, runs] = await Promise.all([
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
    db.select({ id: tournamentHonors.id, label: tournamentHonors.label, type: tournamentHonors.type, state: tournamentHonors.state, entryId: tournamentHonors.entryId, userId: tournamentHonors.userId, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName })
      .from(tournamentHonors).leftJoin(users, eq(users.id, tournamentHonors.userId)).where(eq(tournamentHonors.seasonId, season.id)),
    db.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition())),
    db.select({ id: matches.id, entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB, stage: matches.stage, entryRound: matches.entryRound, ownership: matches.ownership, majorStageRunId: matches.majorStageRunId, bracketNodeId: matches.bracketNodeId, completedAt: matches.completedAt })
      .from(matches).where(and(eq(matches.seasonId, season.id), eq(matches.status, "finished"))).orderBy(asc(matches.completedAt)),
    season.competitionTemplate === "major" ? db.select({ stageKey: majorStageRuns.stageKey, ruleSnapshot: majorStageRuns.ruleSnapshot }).from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)) : [],
  ]);
  const names = new Map(entries.map((entry) => [entry.id, entry.name]));
  const stages = season.competitionTemplate === "major" ? resolveMajorStagePlan(normalizeStagePlan(season.stagePlan), runs) : normalizeStagePlan(season.stagePlan);
  const lastStage = stages.at(-1);
  const brackets = lastStage && season.competitionTemplate !== "major" ? await loadStageBracketViews(db, season.id) : null;
  const finalNode = lastStage && brackets?.get(lastStage.key) ? resolveFinalBracketNodeId(brackets.get(lastStage.key)!) : null;
  const finals = lastStage ? matchRows.filter((match) => match.stage === lastStage.key && (season.competitionTemplate === "major" ? match.entryRound === "final" && match.ownership === "major_stage" && (!result || match.majorStageRunId === result.playoffStageRunId) : finalNode !== null && match.bracketNodeId === String(finalNode))) : [];
  const final = finals.length === 1 ? finals[0] : null;
  const confirmed = result?.status === "confirmed";
  const championHonor = honorRows.filter((honor) => honor.type === "champion");
  const validChampion = championHonor.filter((honor) => honor.state === "valid");
  // An explicit revoked/vacant honor never silently promotes another recipient.
  const championId = championHonor.length ? (validChampion.length === 1 ? validChampion[0].entryId : null)
    : confirmed ? result.championEntryId
    : season.competitionTemplate !== "major" && final && final.scoreA !== null && final.scoreB !== null && final.scoreA !== final.scoreB
      ? final.scoreA > final.scoreB ? final.entryAId : final.entryBId : null;
  const placements = confirmed ? parseMajorFinalPlacementGroups(result.placementGroups, result.championEntryId).flatMap((group) => group.entryIds.map((entryId) => ({ entryId, name: names.get(entryId) ?? "队伍", label: group.from === group.to ? `第 ${group.from} 名` : `第 ${group.from}–${group.to} 名` }))) : season.competitionTemplate !== "major" && final && final.scoreA !== null && final.scoreB !== null && final.scoreA !== final.scoreB
    ? (final.scoreA > final.scoreB ? [final.entryAId, final.entryBId] : [final.entryBId, final.entryAId]).map((entryId, index) => ({ entryId, name: names.get(entryId) ?? "队伍", label: `第 ${index + 1} 名` }))
    : [];
  return {
    stageNames: Object.fromEntries(stages.map((stage) => [stage.key, stage.name])),
    champion: championId && names.has(championId) ? { entryId: championId, name: names.get(championId)! } : null,
    final: final ? { id: final.id, teamA: names.get(final.entryAId) ?? "待定", teamB: names.get(final.entryBId) ?? "待定", scoreA: final.scoreA, scoreB: final.scoreB } : null,
    placements: placements.filter((entry) => names.has(entry.entryId)),
    honors: honorRows.filter((honor) => honor.state === "valid" && (honor.entryId ? names.has(honor.entryId) : honor.userId !== null)).map((honor) => ({ id: honor.id, label: honor.label, entryId: honor.entryId, userId: honor.userId, name: honor.entryId ? names.get(honor.entryId) ?? "队伍" : getPublicDisplayName(honor) })),
    completedAt: matchRows.filter((match) => match.completedAt !== null).at(-1)?.completedAt ?? null,
    finishedMatches: matchRows.length,
  };
}
export type PublicSeasonResults = Awaited<ReturnType<typeof getPublicSeasonResults>>;
