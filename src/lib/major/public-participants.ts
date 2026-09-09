import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  majorPrestartStates,
  majorTournamentEntrants,
  majorTournamentSeeds,
  matches,
  users,
} from "@/db/schema";
import type { PublicSeason } from "@/lib/data/public-seasons";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { ratioOfSums, roundWeightedAvg, simpleAvg } from "@/lib/stats";
import type { StatusPresentation } from "@/lib/presentation";
import type { MatchStatus } from "@/types/match";

export type MajorPublicParticipantSeason = Pick<
  PublicSeason,
  | "id"
  | "slug"
  | "name"
  | "status"
  | "competitionTemplate"
  | "registrationMode"
  | "hasCaptainVoting"
  | "hasDraft"
  | "hasCommunityAwards"
  | "stagePlan"
  | "registrationConfig"
  | "teamRegistrationConfig"
  | "affiliationRules"
  | "minTeamSize"
  | "maxTeamSize"
  | "starterCount"
  | "positions"
>;

export type MajorPublicParticipantPhase =
  | "approved_candidates"
  | "final_entrants"
  | "rosters_frozen";

export interface MajorPublicParticipantStatus {
  label: string;
  tone: StatusPresentation["tone"];
  detail: string;
}

export interface MajorPublicParticipantTeam {
  season: {
    id: string;
    slug: string;
    name: string;
    status: PublicSeason["status"];
  };
  entry: {
    id: string;
    name: string;
    logoUrl: string | null;
    registrationStatus: "approved";
    representativeUserId: string;
    teamId: string | null;
  };
  cardLabel: string;
  participation: MajorPublicParticipantStatus;
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
    winRate: string;
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

export interface MajorPublicParticipantPlayer {
  userId: string;
  entryId: string;
  entryName: string;
  name: string;
  isStarter: boolean;
  isRepresentative: boolean;
  stats: {
    maps: number;
    avgRating: number | null;
    avgAdr: number | null;
    avgKd: number | null;
  } | null;
}

export interface MajorPublicParticipantPresentation {
  teamCollectionLabel: string;
  teamCollectionDescription: string;
  playerHeading: string;
  playerDescription: string;
}

export interface MajorPublicParticipantProjection {
  phase: MajorPublicParticipantPhase;
  presentation: MajorPublicParticipantPresentation;
  entrantCapacity: number;
  approvedCandidateCount: number;
  officialEntrantCount: number;
  teams: MajorPublicParticipantTeam[];
  players: MajorPublicParticipantPlayer[];
}

type PublicEntryRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  registrationStatus: "approved";
  representativeUserId: string;
  teamId: string | null;
  approvedRosterRevisionId: string | null;
  formationOrder: number | null;
  createdAt: Date;
};

type PublicMatch = MajorPublicParticipantTeam["matches"][number];

type RosterMemberRow = {
  entryId: string;
  userId: string;
  displayName: string | null;
  perfectName: string | null;
  steamName: string | null;
  isStarter: boolean;
};

type EventRosterFact = {
  entryId: string;
  status: "preparing" | "confirmed" | "frozen";
};

export interface MajorPublicParticipantLifecycleFacts {
  entrantCapacity: number;
  approvedEntryIds: readonly string[];
  officialEntryIds: readonly string[];
  eventRosterFacts: readonly EventRosterFact[];
  entrantsLockedAt: Date | null;
}

export interface MajorPublicParticipantLifecycleResolution {
  phase: MajorPublicParticipantPhase;
  officialSetComplete: boolean;
}

export function resolveMajorPublicParticipantLifecycle(
  facts: MajorPublicParticipantLifecycleFacts,
): MajorPublicParticipantLifecycleResolution {
  const approvedEntryIdSet = new Set(facts.approvedEntryIds);
  const officialEntryIdSet = new Set(facts.officialEntryIds);
  const officialSetComplete = facts.officialEntryIds.length === facts.entrantCapacity &&
    officialEntryIdSet.size === facts.entrantCapacity &&
    facts.officialEntryIds.every((entryId) => approvedEntryIdSet.has(entryId));
  const eventRosterByEntryId = new Map(facts.eventRosterFacts.map((roster) => [roster.entryId, roster]));
  const allSelectedRostersFrozen = officialSetComplete &&
    facts.officialEntryIds.length === facts.eventRosterFacts.length &&
    facts.officialEntryIds.every((entryId) => eventRosterByEntryId.get(entryId)?.status === "frozen");

  return {
    phase: allSelectedRostersFrozen && facts.entrantsLockedAt
      ? "rosters_frozen"
      : officialSetComplete
        ? "final_entrants"
        : "approved_candidates",
    officialSetComplete,
  };
}

export interface MajorPublicParticipantSeedResolutionInput {
  entrantCapacity: number;
  officialEntryIds: readonly string[];
  seedsConfirmedAt: Date | null;
  seedRows: readonly { entryId: string; seed: number }[];
}

/** Return official seeds only when the confirmed set is complete and valid. */
export function resolveConfirmedMajorSeeds(
  input: MajorPublicParticipantSeedResolutionInput,
): Map<string, number> | null {
  if (!input.seedsConfirmedAt || input.officialEntryIds.length !== input.entrantCapacity) return null;

  const officialEntryIdSet = new Set(input.officialEntryIds);
  const seedEntryIds = new Set(input.seedRows.map((row) => row.entryId));
  const seedNumbers = new Set(input.seedRows.map((row) => row.seed));
  const complete = officialEntryIdSet.size === input.entrantCapacity &&
    input.seedRows.length === input.entrantCapacity &&
    seedEntryIds.size === input.entrantCapacity &&
    seedNumbers.size === input.entrantCapacity &&
    input.seedRows.every((row) => officialEntryIdSet.has(row.entryId) &&
      Number.isInteger(row.seed) && row.seed >= 1 && row.seed <= input.entrantCapacity);

  return complete ? new Map(input.seedRows.map((row) => [row.entryId, row.seed])) : null;
}

type StatRow = {
  user_id: string;
  maps: number | string;
  avg_rating: number | string | null;
  avg_adr: number | string | null;
  avg_kd: number | string | null;
};

export function presentMajorPublicParticipantPhase(phase: MajorPublicParticipantPhase): MajorPublicParticipantPresentation {
  switch (phase) {
    case "rosters_frozen":
      return {
        teamCollectionLabel: "正式参赛队",
        teamCollectionDescription: "本届正式参赛队及最终参赛名单已经确认。",
        playerHeading: "正式参赛队选手",
        playerDescription: "以下选手来自本届最终参赛名单。",
      };
    case "final_entrants":
      return {
        teamCollectionLabel: "正式参赛队",
        teamCollectionDescription: "本届正式参赛队已经确定，参赛名单仍可能调整。",
        playerHeading: "正式参赛队选手",
        playerDescription: "以下选手来自本届当前参赛名单；最终名单仍可能调整。",
      };
    case "approved_candidates":
      return {
        teamCollectionLabel: "已通过报名审核的队伍",
        teamCollectionDescription: "以下队伍已通过报名审核，正赛资格由赛委会确认。",
        playerHeading: "已通过审核队伍选手",
        playerDescription: "以下选手来自已通过审核的队伍，正赛名单待确认。",
      };
  }
}

function addToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function publicRosterMember(
  row: RosterMemberRow,
  representativeUserId: string,
) {
  return {
    userId: row.userId,
    name: getPublicDisplayName(row),
    isStarter: row.isStarter,
    isRepresentative: row.userId === representativeUserId,
  };
}

async function loadMajorPublicParticipantReadModel(
  season: MajorPublicParticipantSeason,
): Promise<{
  projection: MajorPublicParticipantProjection;
  allTeams: MajorPublicParticipantTeam[];
}> {
  const { entrantCapacity } = getStandardMajorDefinition(season);

  const [approvedEntries, entrantRefs, prestartState] = await Promise.all([
    db
      .select({
        id: competitionEntries.id,
        name: competitionEntries.name,
        logoUrl: competitionEntries.logoUrl,
        registrationStatus: competitionEntries.registrationStatus,
        representativeUserId: competitionEntries.representativeUserId,
        teamId: competitionEntries.teamId,
        approvedRosterRevisionId: competitionEntries.approvedRosterRevisionId,
        formationOrder: competitionEntries.formationOrder,
        createdAt: competitionEntries.createdAt,
      })
      .from(competitionEntries)
      .where(and(
        eq(competitionEntries.competitionId, season.id),
        eq(competitionEntries.registrationStatus, "approved"),
      ))
      .orderBy(
        asc(competitionEntries.formationOrder),
        asc(competitionEntries.createdAt),
        asc(competitionEntries.id),
      ),
    db
      .select({
        id: majorTournamentEntrants.id,
        entryId: majorTournamentEntrants.competitionEntryId,
        createdAt: majorTournamentEntrants.createdAt,
      })
      .from(majorTournamentEntrants)
      .where(eq(majorTournamentEntrants.seasonId, season.id))
      .orderBy(asc(majorTournamentEntrants.createdAt), asc(majorTournamentEntrants.id)),
    db.query.majorPrestartStates.findFirst({
      where: eq(majorPrestartStates.seasonId, season.id),
      columns: { entrantsLockedAt: true, seedsConfirmedAt: true },
    }),
  ]) as [PublicEntryRow[], Array<{ id: string; entryId: string; createdAt: Date }>, { entrantsLockedAt: Date | null; seedsConfirmedAt: Date | null } | undefined];

  const officialEntryIds = entrantRefs.map((entrant) => entrant.entryId);
  const approvedEntryIds = approvedEntries.map((entry) => entry.id);

  const [approvedRosterRows, eventRosterFacts, eventRosterMembersRows, seedRows, matchRows, statResult] = await Promise.all([
    approvedEntryIds.length
      ? db
        .select({
          entryId: competitionEntries.id,
          userId: competitionEntryRosterMembers.userId,
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          isStarter: competitionEntryRosterMembers.isPrimaryStarter,
        })
        .from(competitionEntryRosterMembers)
        .innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterRevisions.id, competitionEntryRosterMembers.revisionId))
        .innerJoin(competitionEntries, eq(competitionEntries.approvedRosterRevisionId, competitionEntryRosterRevisions.id))
        .innerJoin(users, and(eq(users.id, competitionEntryRosterMembers.userId), eq(users.status, "active")))
        .where(and(
          inArray(competitionEntries.id, approvedEntryIds),
          eq(competitionEntryRosterRevisions.status, "approved"),
        ))
        .orderBy(asc(competitionEntries.id), asc(users.id))
      : Promise.resolve([] as RosterMemberRow[]),
    officialEntryIds.length
      ? db
        .select({
          entryId: eventRosters.entryId,
          status: eventRosters.status,
        })
        .from(eventRosters)
        .where(inArray(eventRosters.entryId, officialEntryIds))
        .orderBy(asc(eventRosters.entryId))
      : Promise.resolve([] as EventRosterFact[]),
    officialEntryIds.length
      ? db
        .select({
          entryId: eventRosters.entryId,
          userId: eventRosterMembers.userId,
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          isStarter: eventRosterMembers.isPrimaryStarter,
        })
        .from(eventRosterMembers)
        .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
        .innerJoin(users, and(eq(users.id, eventRosterMembers.userId), eq(users.status, "active")))
        .where(inArray(eventRosters.entryId, officialEntryIds))
        .orderBy(asc(eventRosters.entryId), asc(users.id))
      : Promise.resolve([] as RosterMemberRow[]),
    db
      .select({
        entryId: majorTournamentEntrants.competitionEntryId,
        seed: majorTournamentSeeds.seed,
      })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorTournamentSeeds.tournamentEntrantId))
      .where(eq(majorTournamentSeeds.seasonId, season.id)),
    db
      .select({
        id: matches.id,
        entryAId: matches.entryAId,
        entryBId: matches.entryBId,
        status: matches.status,
        isForfeit: matches.isForfeit,
        scheduledAt: matches.scheduledAt,
        completedAt: matches.completedAt,
        scoreA: matches.scoreA,
        scoreB: matches.scoreB,
      })
      .from(matches)
      .where(eq(matches.seasonId, season.id))
      .orderBy(asc(matches.createdAt), asc(matches.id)),
    db.execute(sql`
      SELECT
        mps.user_id,
        count(distinct mps.map_id)::int AS maps,
        ${simpleAvg("mps.rating_pro")} AS avg_rating,
        ${roundWeightedAvg("mps.adr")} AS avg_adr,
        ${ratioOfSums("mps.kills", "mps.deaths")} AS avg_kd
      FROM match_player_stats mps
      JOIN matches m ON m.id = mps.match_id
      JOIN match_maps mm ON mm.id = mps.map_id
      WHERE m.season_id = ${season.id}
        AND mps.verified_by_admin IS NOT NULL
        AND mps.user_id IS NOT NULL
      GROUP BY mps.user_id
    `),
  ]);

  const lifecycle = resolveMajorPublicParticipantLifecycle({
    entrantCapacity,
    approvedEntryIds,
    officialEntryIds,
    eventRosterFacts,
    entrantsLockedAt: prestartState?.entrantsLockedAt ?? null,
  });
  const officialEntryIdSet = new Set(officialEntryIds);
  const { officialSetComplete } = lifecycle;
  const eventRosterByEntryId = new Map(eventRosterFacts.map((roster) => [roster.entryId, roster]));
  const phase = lifecycle.phase;
  const presentation = presentMajorPublicParticipantPhase(phase);
  const seedByEntryId = officialSetComplete
    ? resolveConfirmedMajorSeeds({
      entrantCapacity,
      officialEntryIds,
      seedsConfirmedAt: prestartState?.seedsConfirmedAt ?? null,
      seedRows,
    }) ?? new Map<string, number>()
    : new Map<string, number>();

  const approvedMembersByEntryId = new Map<string, RosterMemberRow[]>();
  for (const row of approvedRosterRows) addToMap(approvedMembersByEntryId, row.entryId, row);
  const eventMembersByEntryId = new Map<string, RosterMemberRow[]>();
  for (const row of eventRosterMembersRows) addToMap(eventMembersByEntryId, row.entryId, row);

  const publicEntryNames = new Map(approvedEntries.map((entry) => [entry.id, entry.name]));
  const matchByEntryId = new Map<string, PublicMatch[]>();
  const winsByEntryId = new Map<string, number>();
  const lossesByEntryId = new Map<string, number>();
  for (const entry of approvedEntries) {
    matchByEntryId.set(entry.id, []);
    winsByEntryId.set(entry.id, 0);
    lossesByEntryId.set(entry.id, 0);
  }
  for (const match of matchRows) {
    if (!publicEntryNames.has(match.entryAId) || !publicEntryNames.has(match.entryBId)) continue;
    const sides = [
      { entryId: match.entryAId, opponentId: match.entryBId, ownScore: match.scoreA, opponentScore: match.scoreB },
      { entryId: match.entryBId, opponentId: match.entryAId, ownScore: match.scoreB, opponentScore: match.scoreA },
    ];
    for (const side of sides) {
      if (match.status === "finished" && side.ownScore !== null && side.opponentScore !== null) {
        if (side.ownScore > side.opponentScore) winsByEntryId.set(side.entryId, (winsByEntryId.get(side.entryId) ?? 0) + 1);
        if (side.ownScore < side.opponentScore) lossesByEntryId.set(side.entryId, (lossesByEntryId.get(side.entryId) ?? 0) + 1);
      }
      addToMap(matchByEntryId, side.entryId, {
        id: match.id,
        opponentId: side.opponentId,
        opponentName: publicEntryNames.get(side.opponentId) ?? null,
        status: match.status,
        isForfeit: match.isForfeit,
        scheduledAt: match.scheduledAt,
        completedAt: match.completedAt,
        ownScore: side.ownScore,
        opponentScore: side.opponentScore,
      });
    }
  }

  const statsByUserId = new Map(
    (statResult.rows as unknown as StatRow[]).map((row) => [
      row.user_id,
      {
        maps: Number(row.maps),
        avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
        avgAdr: row.avg_adr == null ? null : Number(row.avg_adr),
        avgKd: row.avg_kd == null ? null : Number(row.avg_kd),
      },
    ]),
  );

  const allTeams = approvedEntries.map((entry) => {
    const isOfficial = officialSetComplete && officialEntryIdSet.has(entry.id);
    const roster = isOfficial
      ? (eventMembersByEntryId.get(entry.id) ?? [])
      : (approvedMembersByEntryId.get(entry.id) ?? []);
    const seed = isOfficial ? (seedByEntryId.get(entry.id) ?? null) : null;
    const seedPresentation = isOfficial
      ? seed === null
        ? { label: "种子待确认", tone: "neutral" as const }
        : { label: `#${seed} 种子`, tone: "success" as const }
      : null;
    const wins = winsByEntryId.get(entry.id) ?? 0;
    const losses = lossesByEntryId.get(entry.id) ?? 0;
    const played = wins + losses;
    const participation: MajorPublicParticipantStatus = isOfficial
      ? {
        label: "正式参赛队",
        tone: "success",
        detail: phase === "rosters_frozen"
          ? "已进入本届正式参赛队，最终参赛名单已经确认。"
          : "已进入本届正式参赛队，当前参赛名单仍可能调整。",
      }
      : {
        label: "已通过报名审核",
        tone: "info",
        detail: officialSetComplete
          ? "已通过报名审核，但未进入本届正式参赛名单。"
          : "已通过报名审核，正赛资格待确认。",
      };
    const rosterLabel = isOfficial
      ? phase === "rosters_frozen" ? "最终参赛名单" : "当前参赛名单"
      : "已审核报名名单";

    return {
      season: {
        id: season.id,
        slug: season.slug,
        name: season.name,
        status: season.status,
      },
      entry: {
        id: entry.id,
        name: entry.name,
        logoUrl: entry.logoUrl,
        registrationStatus: "approved" as const,
        representativeUserId: entry.representativeUserId,
        teamId: entry.teamId,
      },
      cardLabel: isOfficial ? (seedPresentation?.label === "种子待确认" ? "正式参赛队" : seedPresentation?.label ?? "正式参赛队") : "已通过报名审核",
      participation,
      roster: roster.map((member) => publicRosterMember(member, entry.representativeUserId)),
      rosterLabel,
      rosterStatus: isOfficial ? (eventRosterByEntryId.get(entry.id)?.status ?? null) : null,
      seed,
      seedPresentation,
      record: {
        played,
        wins,
        losses,
        winRate: played > 0 ? `${Math.round(wins / played * 100)}%` : "—",
      },
      matches: matchByEntryId.get(entry.id) ?? [],
    } satisfies MajorPublicParticipantTeam;
  });

  const visibleEntryIdSet = officialSetComplete ? officialEntryIdSet : new Set(approvedEntryIds);
  const visibleTeams = allTeams.filter((team) => visibleEntryIdSet.has(team.entry.id));
  const players = visibleTeams
    .flatMap((team) => team.roster.map((member) => ({
      userId: member.userId,
      entryId: team.entry.id,
      entryName: team.entry.name,
      name: member.name,
      isStarter: member.isStarter,
      isRepresentative: member.isRepresentative,
      stats: statsByUserId.get(member.userId) ?? null,
    })))
    .sort((a, b) => a.entryName.localeCompare(b.entryName) || a.name.localeCompare(b.name));

  return {
    projection: {
      phase,
      presentation,
      entrantCapacity,
      approvedCandidateCount: approvedEntries.length,
      officialEntrantCount: officialEntryIds.length,
      teams: visibleTeams,
      players,
    },
    allTeams,
  };
}

export async function getMajorPublicParticipantProjection(
  season: MajorPublicParticipantSeason,
): Promise<MajorPublicParticipantProjection> {
  const { projection } = await loadMajorPublicParticipantReadModel(season);
  return projection;
}

export async function getMajorPublicParticipantTeam(
  season: MajorPublicParticipantSeason,
  entryId: string,
): Promise<MajorPublicParticipantTeam | null> {
  const { allTeams } = await loadMajorPublicParticipantReadModel(season);
  return allTeams.find((team) => team.entry.id === entryId) ?? null;
}
