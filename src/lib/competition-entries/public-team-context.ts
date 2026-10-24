import { officialMatchCondition } from "@/lib/matches/scope";
import { hasActivePublicSanction } from "@/lib/discipline/public-query";
import { withDisplayScores } from "@/lib/matches/display-score-data";
import { requireCompetitionFields } from "@/lib/matches/competition-context";
import "server-only";

import { and, asc, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  matches,
  steamProfiles,
  users,
} from "@/db/schema";
import { publicCompetitionEntryCondition, publicCompetitionEntryIdentityCondition } from "@/lib/competition-entries/public-visibility";
import {
  presentCompetitionEntryRegistration,
  type CompetitionEntryRegistrationStatus,
} from "@/lib/competition-entries/presentation";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { PublicPlayerIdentity } from "@/lib/identity/public-player";
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
  displayScore?: { own: number | null; opponent: number | null };
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
  participation: {
    label: string;
    tone: StatusPresentation["tone"];
    detail: string;
  };
  roster: Array<PublicPlayerIdentity & {
    isStarter: boolean;
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
  displayScore?: import("@/lib/matches/display-score").DisplayScore;
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
          displayScore: match.displayScore ? { own: side.entryId === match.entryAId ? match.displayScore.scoreA : match.displayScore.scoreB, opponent: side.entryId === match.entryAId ? match.displayScore.scoreB : match.displayScore.scoreA } : undefined,
          ownScore: side.ownScore,
          opponentScore: side.opponentScore,
        });
      }
    }
  }
  return { factsByEntryId, total, finished };
}

type PublicEventTeamMatchScope = { seasonId: string; entryIds: readonly string[] };

async function loadMatchRows(scopes: readonly PublicEventTeamMatchScope[]) {
  const targets = scopes.map(scope => ({ seasonId: scope.seasonId, entryIds: uniqueIds(scope.entryIds) }))
    .filter(scope => scope.entryIds.length > 0);
  return targets.length === 0
    ? []
    : db.query.matches.findMany({
      where: and(
        officialMatchCondition(),
        or(...targets.map(scope => and(eq(matches.seasonId, scope.seasonId),
          or(inArray(matches.entryAId, scope.entryIds), inArray(matches.entryBId, scope.entryIds))))),
      ),
      columns: {
        id: true,
        seasonId: true,
        stage: true,
        entryAId: true,
        entryBId: true,
        status: true,
        format: true,
        resultDisposition: true,
        isForfeit: true,
        scheduledAt: true,
        completedAt: true,
        scoreA: true,
        scoreB: true,
      },
      orderBy: [asc(matches.seasonId), asc(matches.completedAt), asc(matches.scheduledAt), asc(matches.id)],
    }).then(rows => rows.map(requireCompetitionFields));
}

/** Load match rows for one or more public entries and present them per entry. */
export async function getPublicEventTeamMatchFacts(
  seasonId: string,
  entryIds: readonly string[],
): Promise<Map<string, PublicEventTeamMatchFacts>> {
  return (await getPublicEventTeamMatchFactsBatch([{ seasonId, entryIds }])).get(seasonId)!;
}

/** One scoped match read, one BO1 display batch and one public opponent-identity batch,
 * independent of the number of seasons. Callers supply their public entry scopes.
 */
export async function getPublicEventTeamMatchFactsBatch(
  scopes: readonly PublicEventTeamMatchScope[],
): Promise<Map<string, Map<string, PublicEventTeamMatchFacts>>> {
  const targetIdsBySeason = new Map<string, Set<string>>();
  for (const { seasonId, entryIds } of scopes) {
    const ids = targetIdsBySeason.get(seasonId) ?? new Set<string>();
    for (const id of entryIds) ids.add(id);
    targetIdsBySeason.set(seasonId, ids);
  }
  const normalized = [...targetIdsBySeason].map(([seasonId, ids]) => ({ seasonId, entryIds: [...ids] }));
  const entryMatches = await withDisplayScores(await loadMatchRows(normalized));
  const opponentIds = uniqueIds(entryMatches.flatMap(match => {
    const targets = targetIdsBySeason.get(match.seasonId)!;
    return [
      ...(targets.has(match.entryAId) ? [match.entryBId] : []),
      ...(targets.has(match.entryBId) ? [match.entryAId] : []),
    ];
  }));
  const opponents = opponentIds.length
    ? await db.query.competitionEntries.findMany({
      where: and(inArray(competitionEntries.id, opponentIds), publicCompetitionEntryIdentityCondition()),
      columns: { id: true, name: true },
    })
    : [];
  const opponentNames = new Map(opponents.map(opponent => [opponent.id, opponent.name]));
  const matchesBySeason = new Map<string, typeof entryMatches>();
  for (const match of entryMatches) {
    const rows = matchesBySeason.get(match.seasonId) ?? [];
    rows.push(match);
    matchesBySeason.set(match.seasonId, rows);
  }
  return new Map(normalized.map(({ seasonId, entryIds }) => [seasonId,
    collectMatchFacts(matchesBySeason.get(seasonId) ?? [], entryIds, {
      publicEntryIds: new Set([...entryIds, ...opponentNames.keys()]),
      opponentNames,
    }).factsByEntryId,
  ]));
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
    await loadMatchRows([{ seasonId, entryIds: targetIds }]),
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
        personaName: steamProfiles.personaName,
        avatarUrl: steamProfiles.avatarUrl,
        hasActivePublicSanction: hasActivePublicSanction(users.id),
        isStarter: eventRosterMembers.isPrimaryStarter,
      })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
      .innerJoin(users, eq(users.id, eventRosterMembers.userId))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(and(eq(eventRosters.entryId, entry.id), eq(eventRosterMembers.isCurrent, true))),
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
    participation: {
      label: registrationPresentation.label,
      tone: registrationPresentation.tone,
      detail: registrationPresentation.detail,
    },
    roster: rosterRows.map((member) => ({
      userId: member.userId,
      name: getPublicDisplayName(member),
      avatarUrl: member.avatarUrl, hasActivePublicSanction: member.hasActivePublicSanction,
      isStarter: member.isStarter,
    })),
    rosterLabel: "本届参赛名单",
    rosterStatus: eventRoster?.status ?? null,
    seed: null,
    seedPresentation: null,
    record: matchFacts.record,
    matches: matchFacts.matches,
  };
}
