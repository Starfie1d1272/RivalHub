import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  matches,
  users,
} from "@/db/schema";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import {
  presentCompetitionEntryRegistration,
  type CompetitionEntryRegistrationStatus,
} from "@/lib/competition-entries/presentation";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { StatusPresentation } from "@/lib/presentation";
import type { MatchStatus } from "@/types/match";

export type PublicCompetitionEntryTeamSeason = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

export interface PublicCompetitionEntryTeamContext {
  season: PublicCompetitionEntryTeamSeason;
  entry: {
    id: string;
    name: string;
    logoUrl: string | null;
    registrationStatus: CompetitionEntryRegistrationStatus;
    representativeUserId: string;
    teamId: string | null;
  };
  participation: {
    label: string;
    tone: StatusPresentation["tone"];
    detail: string;
  };
  roster: Array<{
    userId: string;
    name: string;
    isStarter: boolean;
    isRepresentative: boolean;
  }>;
  rosterLabel: string;
  rosterStatus: "preparing" | "confirmed" | "frozen" | null;
  seed: number | null;
  seedPresentation: StatusPresentation | null;
  record: {
    played: number;
    wins: number;
    losses: number;
  };
  matches: Array<{
    id: string;
    opponentId: string;
    opponentName: string | null;
    status: MatchStatus;
    isForfeit: boolean;
    scheduledAt: Date | null;
    completedAt: Date | null;
    ownScore: number | null;
    opponentScore: number | null;
  }>;
}

export async function getPublicCompetitionEntryTeamContext(
  season: PublicCompetitionEntryTeamSeason,
  entryId: string,
): Promise<PublicCompetitionEntryTeamContext | null> {
  const entry = await db.query.competitionEntries.findFirst({
    where: and(
      eq(competitionEntries.id, entryId),
      eq(competitionEntries.competitionId, season.id),
      publicCompetitionEntryCondition(),
    ),
    columns: {
      id: true,
      name: true,
      logoUrl: true,
      registrationStatus: true,
      representativeUserId: true,
      teamId: true,
    },
  });
  if (!entry) return null;

  const [eventRoster, rosterRows, entryMatches] = await Promise.all([
    db.query.eventRosters.findFirst({
      where: eq(eventRosters.entryId, entry.id),
      columns: { status: true },
    }),
    db
      .select({
        userId: users.id,
        displayName: users.displayName,
        perfectName: users.perfectName,
        steamName: users.steamName,
        isStarter: eventRosterMembers.isPrimaryStarter,
      })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
      .innerJoin(users, eq(users.id, eventRosterMembers.userId))
      .where(eq(eventRosters.entryId, entry.id)),
    db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, season.id),
        or(eq(matches.entryAId, entry.id), eq(matches.entryBId, entry.id)),
      ),
    }),
  ]);

  const opponentIds = [...new Set(entryMatches.map((match) => match.entryAId === entry.id ? match.entryBId : match.entryAId))];
  const opponents = opponentIds.length
    ? await db.query.competitionEntries.findMany({
      where: and(inArray(competitionEntries.id, opponentIds), publicCompetitionEntryCondition()),
      columns: { id: true, name: true },
    })
    : [];
  const opponentNames = new Map(opponents.map((opponent) => [opponent.id, opponent.name]));

  const registrationPresentation = presentCompetitionEntryRegistration(entry.registrationStatus);

  let wins = 0;
  let losses = 0;
  for (const match of entryMatches) {
    if (match.status !== "finished" || match.scoreA === null || match.scoreB === null) continue;
    const ownScore = match.entryAId === entry.id ? match.scoreA : match.scoreB;
    const opponentScore = match.entryAId === entry.id ? match.scoreB : match.scoreA;
    if (ownScore > opponentScore) wins += 1;
    if (ownScore < opponentScore) losses += 1;
  }

  return {
    season,
    entry,
    participation: {
      label: registrationPresentation.label,
      tone: registrationPresentation.tone,
      detail: registrationPresentation.detail,
    },
    roster: rosterRows.map((member) => ({
      userId: member.userId,
      name: getPublicDisplayName(member),
      isStarter: member.isStarter,
      isRepresentative: member.userId === entry.representativeUserId,
    })),
    rosterLabel: "本届参赛名单",
    rosterStatus: eventRoster?.status ?? null,
    seed: null,
    seedPresentation: null,
    record: { played: wins + losses, wins, losses },
    matches: entryMatches.map((match) => {
      const isA = match.entryAId === entry.id;
      const opponentId = isA ? match.entryBId : match.entryAId;
      return {
        id: match.id,
        opponentId,
        opponentName: opponentNames.get(opponentId) ?? null,
        status: match.status,
        isForfeit: match.isForfeit,
        scheduledAt: match.scheduledAt,
        completedAt: match.completedAt,
        ownScore: isA ? match.scoreA : match.scoreB,
        opponentScore: isA ? match.scoreB : match.scoreA,
      };
    }),
  };
}
