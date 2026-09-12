import "server-only";

import { and, asc, eq, inArray, or } from "drizzle-orm";

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

export type PublicEventTeamSeason = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

export type PublicEventTeamRecord = {
  played: number;
  wins: number;
  losses: number;
  winRate: string;
};

export type PublicEventTeamMatch = {
  id: string;
  opponentId: string;
  opponentName: string | null;
  status: MatchStatus;
  isForfeit: boolean;
  scheduledAt: Date | null;
  completedAt: Date | null;
  stage?: string;
  ownScore: number | null;
  opponentScore: number | null;
};

export interface PublicEventTeamContext {
  season: PublicEventTeamSeason;
  entry: {
    id: string;
    name: string;
    logoUrl: string | null;
    registrationStatus: CompetitionEntryRegistrationStatus;
    representativeUserId: string;
    teamId: string | null;
  };
  cardLabel: string;
  participation: {
    label: string;
    tone: StatusPresentation["tone"];
    detail: string;
  };
  roster: Array<{
    userId: string;
    avatarUrl?: string | null;
    name: string;
    isStarter: boolean;
    isRepresentative: boolean;
  }>;
  rosterLabel: string;
  rosterStatus: "preparing" | "confirmed" | "frozen" | null;
  seed: number | null;
  seedPresentation: StatusPresentation | null;
  record: PublicEventTeamRecord;
  matches: PublicEventTeamMatch[];
}

/** A list-card projection of the same event-team contract without match rows. */
export type PublicEventTeamSummary = Omit<PublicEventTeamContext, "matches">;

export interface PublicEventTeamMatchFacts {
  record: PublicEventTeamRecord;
  matches: PublicEventTeamMatch[];
}

export interface PublicEventTeamMatchSummary {
  records: Map<string, PublicEventTeamRecord>;
  total: number;
  finished: number;
}

export function createEmptyPublicEventTeamRecord(): PublicEventTeamRecord {
  return { played: 0, wins: 0, losses: 0, winRate: "—" };
}

function finishRecord(record: Omit<PublicEventTeamRecord, "winRate">): PublicEventTeamRecord {
  return {
    ...record,
    winRate: record.played > 0 ? `${Math.round(record.wins / record.played * 100)}%` : "—",
  };
}

function addResult(record: Omit<PublicEventTeamRecord, "winRate">, ownScore: number | null, opponentScore: number | null): void {
  if (ownScore === null || opponentScore === null) return;
  if (ownScore > opponentScore) {
    record.wins += 1;
  } else if (ownScore < opponentScore) {
    record.losses += 1;
  }
  record.played = record.wins + record.losses;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

type CollectedMatchFacts = {
  factsByEntryId: Map<string, PublicEventTeamMatchFacts>;
  total: number;
  finished: number;
};

type PublicMatchRow = {
  stage?: string;
  id: string;
  entryAId: string;
  entryBId: string;
  status: MatchStatus;
  isForfeit: boolean;
  scheduledAt: Date | null;
  completedAt: Date | null;
  scoreA: number | null;
  scoreB: number | null;
};

function collectMatchFacts(
  entryMatches: readonly PublicMatchRow[],
  entryIds: readonly string[],
  options: { publicEntryIds?: ReadonlySet<string>; opponentNames?: ReadonlyMap<string, string> } = {},
): CollectedMatchFacts {
  const targetIds = new Set(entryIds);
  const factsByEntryId = new Map<string, PublicEventTeamMatchFacts>();
  for (const entryId of targetIds) {
    factsByEntryId.set(entryId, { record: createEmptyPublicEventTeamRecord(), matches: [] });
  }

  let total = 0;
  let finished = 0;
  for (const match of entryMatches) {
    if (options.publicEntryIds && (!options.publicEntryIds.has(match.entryAId) || !options.publicEntryIds.has(match.entryBId))) continue;
    total += 1;
    if (match.status === "finished") finished += 1;
    for (const side of [
      { entryId: match.entryAId, opponentId: match.entryBId, ownScore: match.scoreA, opponentScore: match.scoreB },
      { entryId: match.entryBId, opponentId: match.entryAId, ownScore: match.scoreB, opponentScore: match.scoreA },
    ]) {
      if (!targetIds.has(side.entryId)) continue;
      const facts = factsByEntryId.get(side.entryId)!;
      if (match.status === "finished") {
        const record = { played: facts.record.played, wins: facts.record.wins, losses: facts.record.losses };
        addResult(record, side.ownScore, side.opponentScore);
        facts.record = finishRecord(record);
      }
      if (options.opponentNames) {
        facts.matches.push({
          id: match.id,
          opponentId: side.opponentId,
          opponentName: options.opponentNames.get(side.opponentId) ?? null,
          status: match.status,
          isForfeit: match.isForfeit,
          scheduledAt: match.scheduledAt,
          completedAt: match.completedAt,
          stage: match.stage,
          ownScore: side.ownScore,
          opponentScore: side.opponentScore,
        });
      }
    }
  }
  return { factsByEntryId, total, finished };
}

async function loadMatchRows(seasonId: string, entryIds: readonly string[]) {
  const targetIds = uniqueIds(entryIds);
  return targetIds.length === 0
    ? []
    : db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, seasonId),
        or(inArray(matches.entryAId, targetIds), inArray(matches.entryBId, targetIds)),
      ),
      columns: {
        id: true,
        stage: true,
        entryAId: true,
        entryBId: true,
        status: true,
        isForfeit: true,
        scheduledAt: true,
        completedAt: true,
        scoreA: true,
        scoreB: true,
      },
      orderBy: [asc(matches.completedAt), asc(matches.scheduledAt), asc(matches.id)],
    });
}

/** Load match rows for one or more public entries and present them per entry. */
export async function getPublicEventTeamMatchFacts(
  seasonId: string,
  entryIds: readonly string[],
): Promise<Map<string, PublicEventTeamMatchFacts>> {
  const targetIds = uniqueIds(entryIds);
  if (targetIds.length === 0) return new Map();
  const entryMatches = await loadMatchRows(seasonId, targetIds);
  const targetIdSet = new Set(targetIds);
  const opponentIds = uniqueIds(entryMatches.flatMap((match) => [
    ...(targetIdSet.has(match.entryAId) ? [match.entryBId] : []),
    ...(targetIdSet.has(match.entryBId) ? [match.entryAId] : []),
  ]));
  const opponents = opponentIds.length
    ? await db.query.competitionEntries.findMany({
      where: and(inArray(competitionEntries.id, opponentIds), publicCompetitionEntryCondition()),
      columns: { id: true, name: true },
    })
    : [];
  const publicEntryIds = new Set([...targetIds, ...opponents.map((opponent) => opponent.id)]);
  return collectMatchFacts(
    entryMatches,
    targetIds,
    {
      publicEntryIds,
      opponentNames: new Map(opponents.map((opponent) => [opponent.id, opponent.name])),
    },
  ).factsByEntryId;
}

/** Load only the record/count data needed by a public team list or overview. */
export async function getPublicEventTeamMatchSummary(
  seasonId: string,
  entryIds: readonly string[],
  publicEntryIds: readonly string[] = entryIds,
): Promise<PublicEventTeamMatchSummary> {
  const targetIds = uniqueIds(entryIds);
  if (targetIds.length === 0 || publicEntryIds.length === 0) {
    return { records: new Map(), total: 0, finished: 0 };
  }
  const collected = collectMatchFacts(
    await loadMatchRows(seasonId, targetIds),
    targetIds,
    { publicEntryIds: new Set(publicEntryIds) },
  );
  return {
    records: new Map([...collected.factsByEntryId].map(([entryId, facts]) => [entryId, facts.record])),
    total: collected.total,
    finished: collected.finished,
  };
}

export async function getPublicCompetitionEntryTeamContext(
  season: PublicEventTeamSeason,
  entryId: string,
): Promise<PublicEventTeamContext | null> {
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

  const [eventRoster, rosterRows, matchFactsByEntryId] = await Promise.all([
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
        avatarUrl: users.avatarUrl,
        isStarter: eventRosterMembers.isPrimaryStarter,
      })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
      .innerJoin(users, eq(users.id, eventRosterMembers.userId))
      .where(eq(eventRosters.entryId, entry.id)),
    getPublicEventTeamMatchFacts(season.id, [entry.id]),
  ]);
  const matchFacts = matchFactsByEntryId.get(entry.id) ?? {
    record: createEmptyPublicEventTeamRecord(),
    matches: [],
  };
  const registrationPresentation = presentCompetitionEntryRegistration(entry.registrationStatus);

  return {
    season,
    entry,
    cardLabel: entry.registrationStatus === "approved" ? "已通过报名审核" : registrationPresentation.label,
    participation: {
      label: registrationPresentation.label,
      tone: registrationPresentation.tone,
      detail: registrationPresentation.detail,
    },
    roster: rosterRows.map((member) => ({
      userId: member.userId,
      name: getPublicDisplayName(member),
      avatarUrl: member.avatarUrl,
      isStarter: member.isStarter,
      isRepresentative: member.userId === entry.representativeUserId,
    })),
    rosterLabel: "本届参赛名单",
    rosterStatus: eventRoster?.status ?? null,
    seed: null,
    seedPresentation: null,
    record: matchFacts.record,
    matches: matchFacts.matches,
  };
}
