import "server-only";

import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, majorFinalResults, matches, postEventAdjudications, tournamentHonors } from "@/db/schema";
import { parseMajorFinalPlacementGroups } from "@/lib/major/placement";
import type { Season } from "@/db/schema/seasons";
import type { PostEventPageData } from "./types";

export async function loadPostEventPageData(season: Season): Promise<PostEventPageData> {
  if (season.competitionTemplate !== "major") {
    const [matchCountRows, honorCountRows, activeAdjudicationCountRows] = await Promise.all([
      db.select({ count: count() }).from(matches).where(eq(matches.seasonId, season.id)),
      db.select({ count: count() }).from(tournamentHonors).where(eq(tournamentHonors.seasonId, season.id)),
      db.select({ count: count() }).from(postEventAdjudications)
        .where(and(eq(postEventAdjudications.seasonId, season.id), eq(postEventAdjudications.status, "active"))),
    ]);
    return {
      season: { id: season.id, name: season.name, status: season.status, competitionTemplate: season.competitionTemplate },
      data: {
        seasonId: season.id,
        seasonStatus: season.status,
        competitionTemplate: season.competitionTemplate,
        matchCount: Number(matchCountRows[0]?.count ?? 0),
        honorCount: Number(honorCountRows[0]?.count ?? 0),
        activeAdjudicationCount: Number(activeAdjudicationCountRows[0]?.count ?? 0),
        finalResult: null,
        teams: [],
        honors: [],
        adjudications: [],
      },
    };
  }

  const [seasonTeams, finalResult, honorRows, adjudicationRows, matchCountRows] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, season.id),
      orderBy: [asc(competitionEntries.createdAt)],
      columns: { id: true, name: true },
    }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
    db.select({ id: tournamentHonors.id, honorKey: tournamentHonors.honorKey, type: tournamentHonors.type, label: tournamentHonors.label, state: tournamentHonors.state, entryId: tournamentHonors.entryId, userId: tournamentHonors.userId, placementFrom: tournamentHonors.placementFrom, placementTo: tournamentHonors.placementTo })
      .from(tournamentHonors).where(eq(tournamentHonors.seasonId, season.id)).orderBy(asc(tournamentHonors.createdAt)),
    db.select({ id: postEventAdjudications.id, status: postEventAdjudications.status, kind: postEventAdjudications.kind, target: postEventAdjudications.target, impacts: postEventAdjudications.impacts, targetEntryId: postEventAdjudications.targetEntryId, targetUserId: postEventAdjudications.targetUserId, targetMatchId: postEventAdjudications.targetMatchId, reason: postEventAdjudications.reason, explanation: postEventAdjudications.publicExplanation, createdAt: postEventAdjudications.createdAt })
      .from(postEventAdjudications).where(eq(postEventAdjudications.seasonId, season.id)).orderBy(asc(postEventAdjudications.createdAt)),
    db.select({ count: count() }).from(matches).where(eq(matches.seasonId, season.id)),
  ]);

  return {
    season: { id: season.id, name: season.name, status: season.status, competitionTemplate: season.competitionTemplate },
    data: {
      seasonId: season.id,
      seasonStatus: season.status,
      competitionTemplate: season.competitionTemplate,
      matchCount: Number(matchCountRows[0]?.count ?? 0),
      honorCount: honorRows.length,
      activeAdjudicationCount: adjudicationRows.filter((row) => row.status === "active").length,
      finalResult: finalResult ? {
        id: finalResult.id,
        status: finalResult.status,
        championEntryId: finalResult.championEntryId,
        placementGroups: parseMajorFinalPlacementGroups(finalResult.placementGroups, finalResult.championEntryId).map((group) => ({ ...group, entryIds: [...group.entryIds] })),
      } : null,
      teams: seasonTeams,
      honors: honorRows,
      adjudications: adjudicationRows.map((row) => ({ ...row, impacts: row.impacts as string[] })),
    },
  };
}
