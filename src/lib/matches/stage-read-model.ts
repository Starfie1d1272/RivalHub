import { withDbTrafficSource } from "@/lib/observability/db-traffic";
import { withDisplayScores } from "@/lib/matches/display-score-data";
import { requireCompetitionMatch, requireCompetitionFields, type CompetitionMatch } from "./competition-context";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, majorStageEntrants, majorStageRuns, majorTournamentEntrants, matches } from "@/db/schema";
import type { PublicScheduleMatch } from "./schedule-read";
import { parseMajorRunPresentation } from "@/lib/major/run-snapshot";
import { majorRunPresentationSelection } from "@/lib/major/run-snapshot-query";
import { MAJOR_SWISS_MAX_ROUNDS, projectMajorSwissStage, projectMajorSwissStageByRound, type MajorSwissFinalizedRound, type MajorSwissMatchFact } from "@/lib/major/swiss";
import type { SwissStatus } from "@/lib/swiss/types";

export interface StageSwissMatchRow {
  matchId: string;
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamALogoUrl?: string | null;
  teamBLogoUrl?: string | null;
  teamBName: string;
  displayScore?: import("./display-score").DisplayScore;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  format: string;
  round: number;
}

export interface StageSwissRecordGroup {
  record: string;
  matchups: StageSwissMatchRow[];
}

export interface StageSwissRoundColumn {
  round: number;
  status: "finished" | "active" | "upcoming";
  groups: StageSwissRecordGroup[];
}

export interface SwissStageReadModel {
  stageName: string;
  stageKey: string;
  seedPrefix?: "P";
  finalizedRound: number;
  teamCount: number;
  advanceCount: number;
  rounds: StageSwissRoundColumn[];
  competitionEntries: Array<{
    entryId: string;
    teamName: string;
    logoUrl?: string | null;
    seed: number;
    wins: number;
    losses: number;
    /** Canonical Swiss Buchholz/difficulty fact from the domain projection. */
    difficultyScore: number;
    status: SwissStatus;
  }>;
}

export type MajorSwissStageReadModel = SwissStageReadModel;

/**
 * Public/admin Swiss projection. StageRun membership, managed match facts, and
 * finalizedRound are the only inputs to this read model. Supplied schedule rows
 * are re-scoped to the owning run before projection.
 */
export async function loadMajorSwissStageReadModel(
  seasonId: string,
  stageKey: string,
  displayedMatches?: readonly (CompetitionMatch<PublicScheduleMatch> & { displayScore: import("./display-score").DisplayScore })[],
): Promise<SwissStageReadModel | null> {
  return withDbTrafficSource("match.swiss.read", async () => {
    const [stageRun] = await db.select({ id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, finalizedRound: majorStageRuns.finalizedRound, presentationInput: majorRunPresentationSelection(majorStageRuns.ruleSnapshot) }).from(majorStageRuns)
      .where(and(eq(majorStageRuns.seasonId, seasonId), eq(majorStageRuns.stageKey, stageKey)))
      .limit(1);
    if (!stageRun) return null;
    const frozenSnapshot = parseMajorRunPresentation(stageRun.presentationInput, stageKey);

    const [entrantRows, managedMatches] = await Promise.all([
      db.select({
        entryId: majorTournamentEntrants.competitionEntryId,
        seed: majorStageEntrants.stageSeed,
        teamName: competitionEntries.name,
        logoUrl: competitionEntries.logoUrl,
      }).from(majorStageEntrants)
        .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorStageEntrants.tournamentEntrantId))
        .innerJoin(competitionEntries, eq(competitionEntries.id, majorTournamentEntrants.competitionEntryId))
        .where(eq(majorStageEntrants.stageRunId, stageRun.id))
        .orderBy(asc(majorStageEntrants.stageSeed)),

      displayedMatches ? Promise.resolve(displayedMatches.filter(match =>
        match.seasonId === seasonId && match.stage === stageKey && match.majorStageRunId === stageRun.id && match.ownership === "major_stage",
      ).sort((a, b) => (a.round ?? Infinity) - (b.round ?? Infinity) ||
        (a.completedAt?.getTime() ?? Infinity) - (b.completedAt?.getTime() ?? Infinity) ||
        (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity) || a.id.localeCompare(b.id))) :
        db.query.matches.findMany({
          where: and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey), eq(matches.majorStageRunId, stageRun.id), eq(matches.ownership, "major_stage")),
          orderBy: [asc(matches.round), asc(matches.completedAt), asc(matches.scheduledAt), asc(matches.id)],
        }).then(rows => withDisplayScores(rows.map(requireCompetitionMatch))),
    ]);
    const logoByEntryId = new Map(entrantRows.map(row => [row.entryId, row.logoUrl]));
    const nameByEntryId = new Map(entrantRows.map((row) => [row.entryId, row.teamName]));
    const finalizedRound = asFinalizedRound(stageRun.finalizedRound);
    const completedFacts: MajorSwissMatchFact[] = managedMatches
      .filter((match) => match.status === "finished" && match.completedAt !== null && match.scoreA !== null && match.scoreB !== null && match.round !== null)
      .map((match) => ({
        matchId: match.id,
        round: match.round as MajorSwissMatchFact["round"],
        entryAId: match.entryAId,
        entryBId: match.entryBId,
        winnerId: match.scoreA! > match.scoreB! ? match.entryAId : match.entryBId,
      }));

    let projection;
    try {
      projection = projectMajorSwissStage({
        entrants: entrantRows.map((row) => ({ teamId: row.entryId, initialStageSeed: row.seed })),
        matches: completedFacts,
        finalizedRound,
      });
    } catch {
      // Invalid/incomplete runtime facts must fall back to the canonical match
      // list rather than inventing a standings projection for the public page.
      return null;
    }

    const roundProjections = projectMajorSwissStageByRound({
      entrants: entrantRows.map((row) => ({ teamId: row.entryId, initialStageSeed: row.seed })),
      matches: completedFacts,
      finalizedRound,
  });
  const matchRows = managedMatches
    .filter((match) => match.round !== null)
    .map((match) => ({
      matchId: match.id,
      entryAId: match.entryAId,
      entryBId: match.entryBId,
      teamAName: nameByEntryId.get(match.entryAId) ?? "待定",
      teamBName: nameByEntryId.get(match.entryBId) ?? "待定",
      teamALogoUrl: logoByEntryId.get(match.entryAId) ?? null,
      teamBLogoUrl: logoByEntryId.get(match.entryBId) ?? null,
      displayScore: match.displayScore,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      status: match.status,
      format: match.format,
      round: match.round!,
    }));
  const rounds: StageSwissRoundColumn[] = [];
  for (let round = 1; round <= MAJOR_SWISS_MAX_ROUNDS; round += 1) {
    const rows = matchRows.filter((match) => match.round === round);
    const beforeRound = round <= finalizedRound ? roundProjections[round - 1] : projection;
    const stateByEntryId = new Map(beforeRound?.teams.map((team) => [team.teamId, team]) ?? []);
    const groups = new Map<string, StageSwissMatchRow[]>();
    for (const row of rows) {
      const key = swissRecordLabel(stateByEntryId, row.entryAId, row.entryBId);
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    rounds.push({
      round,
      status: round <= finalizedRound ? "finished" : round === finalizedRound + 1 && rows.length > 0 ? "active" : "upcoming",
      groups: [...groups.entries()].map(([record, matchups]) => ({ record, matchups })),
    });
  }

  return {
    stageName: frozenSnapshot.stage.name,
    stageKey,
    finalizedRound,
    teamCount: projection.teams.length,
    advanceCount: projection.advanced.length,
    rounds,
    competitionEntries: projection.teams.map((team) => ({
      entryId: team.teamId,
      teamName: nameByEntryId.get(team.teamId) ?? "未知队伍",
      logoUrl: logoByEntryId.get(team.teamId) ?? null,
      seed: team.currentStageSeed,
      wins: team.wins,
      losses: team.losses,
      difficultyScore: team.difficultyScore,
      status: team.status,
    })),
  };
  });
}

function asFinalizedRound(value: number): MajorSwissFinalizedRound {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  throw new Error("invalid Major Swiss finalizedRound");
}

function swissRecordLabel(states: ReadonlyMap<string, { wins: number; losses: number }>, entryAId: string, entryBId: string) {
  const a = states.get(entryAId), b = states.get(entryBId);
  const keyA = a ? `${a.wins}:${a.losses}` : "待定";
  const keyB = b ? `${b.wins}:${b.losses}` : "待定";
  return keyA === keyB ? keyA : `${keyA} | ${keyB}`;
}

/** Room-guide projection of the same frozen run; no names, logos or display-score reads. */
export async function loadMajorSwissMatchRecord(seasonId: string, stageKey: string, matchId: string) {
  const [run] = await db.select({ id: majorStageRuns.id, finalizedRound: majorStageRuns.finalizedRound,
    stageKey: majorStageRuns.stageKey, presentationInput: majorRunPresentationSelection(majorStageRuns.ruleSnapshot) }).from(majorStageRuns)
    .where(and(eq(majorStageRuns.seasonId, seasonId), eq(majorStageRuns.stageKey, stageKey))).limit(1);
  if (!run) return null;
  const frozen = parseMajorRunPresentation(run.presentationInput, stageKey);
  const [entrants, rows] = await Promise.all([
    db.select({ teamId: majorTournamentEntrants.competitionEntryId, initialStageSeed: majorStageEntrants.stageSeed })
      .from(majorStageEntrants).innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorStageEntrants.tournamentEntrantId))
      .innerJoin(competitionEntries, eq(competitionEntries.id, majorTournamentEntrants.competitionEntryId))
      .where(eq(majorStageEntrants.stageRunId, run.id)),
    db.select({ id: matches.id, entryAId: matches.entryAId, entryBId: matches.entryBId, round: matches.round,
      status: matches.status, completedAt: matches.completedAt, scoreA: matches.scoreA, scoreB: matches.scoreB })
      .from(matches).where(and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey), eq(matches.majorStageRunId, run.id), eq(matches.ownership, "major_stage"))),
  ]);
  const scopedRows = rows.map(row => requireCompetitionFields(row));
  const target = scopedRows.find(row => row.id === matchId);
  if (!target?.round || target.round < 1 || target.round > MAJOR_SWISS_MAX_ROUNDS) return null;
  const facts: MajorSwissMatchFact[] = scopedRows.filter(row => row.status === "finished" && row.completedAt !== null &&
    row.scoreA !== null && row.scoreB !== null && row.round !== null).map(row => ({
      matchId: row.id, round: row.round as MajorSwissMatchFact["round"], entryAId: row.entryAId!, entryBId: row.entryBId!,
      winnerId: row.scoreA! > row.scoreB! ? row.entryAId! : row.entryBId!,
    }));
  const finalizedRound = asFinalizedRound(run.finalizedRound);
  let projection;
  try { projection = projectMajorSwissStage({ entrants, matches: facts, finalizedRound }); }
  catch { return null; }
  const before = target.round <= finalizedRound
    ? projectMajorSwissStage({ entrants, matches: facts, finalizedRound: asFinalizedRound(target.round - 1) })
    : projection;
  return { stageName: frozen.stage.name,
    record: swissRecordLabel(new Map(before.teams.map(team => [team.teamId, team])), target.entryAId!, target.entryBId!) };
}
