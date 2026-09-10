import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, majorStageEntrants, majorStageRuns, majorTournamentEntrants, matches } from "@/db/schema";
import { parseMajorRunSnapshot } from "@/lib/major/run-snapshot";
import { projectMajorSwissStage, projectMajorSwissStageByRound, type MajorSwissFinalizedRound, type MajorSwissMatchFact, type MajorSwissStatus } from "@/lib/major/swiss";

export interface StageSwissMatchRow {
  matchId: string;
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
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

export interface MajorSwissStageReadModel {
  stageName: string;
  stageKey: string;
  finalizedRound: MajorSwissFinalizedRound;
  teamCount: number;
  advanceCount: number;
  rounds: StageSwissRoundColumn[];
  competitionEntries: Array<{
    entryId: string;
    teamName: string;
    seed: number;
    wins: number;
    losses: number;
    status: MajorSwissStatus;
  }>;
}

/**
 * Public/admin Swiss projection. The old swiss_standings table is deliberately
 * not read: StageRun membership, managed match facts, and finalizedRound are
 * the only inputs to this read model.
 */
export async function loadMajorSwissStageReadModel(
  seasonId: string,
  stageKey: string,
): Promise<MajorSwissStageReadModel | null> {
  const [stageRun] = await db.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.seasonId, seasonId), eq(majorStageRuns.stageKey, stageKey)))
    .limit(1);
  if (!stageRun) return null;
  const frozenSnapshot = parseMajorRunSnapshot(stageRun.ruleSnapshot, stageKey);

  const entrantRows = await db.select({
    entryId: majorTournamentEntrants.competitionEntryId,
    seed: majorStageEntrants.stageSeed,
    teamName: competitionEntries.name,
  }).from(majorStageEntrants)
    .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorStageEntrants.tournamentEntrantId))
    .innerJoin(competitionEntries, eq(competitionEntries.id, majorTournamentEntrants.competitionEntryId))
    .where(eq(majorStageEntrants.stageRunId, stageRun.id))
    .orderBy(asc(majorStageEntrants.stageSeed));

  const managedMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.seasonId, seasonId),
      eq(matches.stage, stageKey),
      eq(matches.majorStageRunId, stageRun.id),
      eq(matches.ownership, "major_stage"),
    ),
    orderBy: [asc(matches.round), asc(matches.createdAt)],
  });
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
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      status: match.status,
      format: match.format,
      round: match.round!,
    }));
  const rounds: StageSwissRoundColumn[] = [];
  for (let round = 1; round <= 5; round += 1) {
    const rows = matchRows.filter((match) => match.round === round);
    const beforeRound = round <= finalizedRound ? roundProjections[round - 1] : projection;
    const stateByEntryId = new Map(beforeRound?.teams.map((team) => [team.teamId, team]) ?? []);
    const groups = new Map<string, StageSwissMatchRow[]>();
    for (const row of rows) {
      const recordA = stateByEntryId.get(row.entryAId);
      const recordB = stateByEntryId.get(row.entryBId);
      const keyA = recordA ? `${recordA.wins}:${recordA.losses}` : "待定";
      const keyB = recordB ? `${recordB.wins}:${recordB.losses}` : "待定";
      const key = keyA === keyB ? keyA : `${keyA} | ${keyB}`;
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
      seed: team.currentStageSeed,
      wins: team.wins,
      losses: team.losses,
      status: team.status,
    })),
  };
}

function asFinalizedRound(value: number): MajorSwissFinalizedRound {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  throw new Error("invalid Major Swiss finalizedRound");
}
