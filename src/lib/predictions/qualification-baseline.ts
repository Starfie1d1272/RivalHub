import "server-only";
import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  competitionQualificationRuns,
  competitionQualificationEntrants,
  competitionEntries,
  matches,
} from "@/db/schema";
import {
  assertRunSnapshot,
  validateShortSwissHistory,
  playInSwissEntrants,
} from "@/lib/competition-qualification/history";
import { AppError, ErrorCode } from "@/lib/errors";
import { officialWinner } from "./baseline";
import {
  SIMULATION_VERSION,
  type Baseline,
  type QualificationShortSwissContext,
} from "./types";

export async function loadQualificationContext(
  tx: TxDb,
  seasonId: string,
  name: string,
): Promise<QualificationShortSwissContext | null> {
  const [run] = await tx
    .select()
    .from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, seasonId));
  if (!run || run.format !== "short_swiss_2w2l") return null;
  const entrants = await tx
    .select()
    .from(competitionQualificationEntrants)
    .where(eq(competitionQualificationEntrants.runId, run.id))
    .orderBy(asc(competitionQualificationEntrants.preliminarySeed));
  assertRunSnapshot(run, entrants);
  const official = await tx
    .select()
    .from(matches)
    .where(eq(matches.qualificationRunId, run.id))
    .orderBy(asc(matches.round), asc(matches.id));
  if (
    official.some(
      (m) =>
        m.status === "cancelled" ||
        (m.status === "finished" && !officialWinner(m)),
    )
  ) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Play-in 官方赛况不完整，请等待赛事方修正。",
    );
  }
  const history = validateShortSwissHistory(run, entrants, official);
  if (
    (run.startedAt && !official.length) ||
    (run.completedAt && !history.projection.isComplete)
  ) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Play-in 运行状态与官方赛况不一致。",
    );
  }
  const teamRows = await tx
    .select({
      teamId: competitionEntries.id,
      name: competitionEntries.name,
      logoUrl: competitionEntries.logoUrl,
      tournamentSeed: competitionQualificationEntrants.preliminarySeed,
    })
    .from(competitionQualificationEntrants)
    .innerJoin(
      competitionEntries,
      eq(
        competitionEntries.id,
        competitionQualificationEntrants.competitionEntryId,
      ),
    )
    .where(eq(competitionQualificationEntrants.runId, run.id))
    .orderBy(asc(competitionQualificationEntrants.preliminarySeed));
  const playing = playInSwissEntrants(entrants, run.directEntryCount);
  const baseline: Baseline = {
    version: SIMULATION_VERSION,
    seasonId,
    name,
    capturedAt: new Date().toISOString(),
    stages: [
      {
        key: "play-in",
        name: "Play-in",
        type: "swiss",
        matchFormat: "bo1",
        entrySeeds: playing.length,
        finalFormat: null,
        previousKey: null,
        nextKey: null,
        directSeeds: [1, playing.length],
      },
    ],
    teams: teamRows.filter((t) => playing.some((e) => e.teamId === t.teamId)),
    runs: [],
    matches: official.map((m) => ({
      id: m.id,
      stageKey: "play-in",
      key: `r${m.round}-${[m.entryAId, m.entryBId].sort().join(":")}`,
      round: m.round!,
      a: m.entryAId,
      b: m.entryBId,
      winner: officialWinner(m),
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      format: m.format,
      status: m.status,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
    })),
  };
  baseline.revision = createHash("sha256")
    .update(
      JSON.stringify({
        runId: run.id,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        teams: baseline.teams,
        matches: baseline.matches,
      }),
    )
    .digest("hex");
  return {
    kind: "qualification-short-swiss",
    baseline,
    runId: run.id,
    entrants: playing,
  };
}
