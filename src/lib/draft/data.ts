import { and, asc, count, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  draftState,
  draftPicks,
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  seasonRegistrations,
  users,
} from "@/db/schema";
import { DRAFT_TEAMS, DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import type { MapPreference } from "@/types/season";
import { getSnakeOrder } from "./rules";

// ── 公开 DTO ─────────────────────────────────────────────

export interface DraftTeamSlot {
  entryId: string;
  teamName: string;
  draftOrder: number;
  captain: {
    steamName: string;
    displayName: string | null;
    perfectName: string | null;
    primaryPosition: string;
  };
  members: {
    steamName: string;
    perfectName: string | null;
    displayName: string | null;
    primaryPosition: string;
    pickRound: number;
    pickNumber: number;
    autoPicked: boolean;
  }[];
}

/** Fields allowed on the anonymous spectator draft page. */
export interface PublicDraftPlayer {
  userId: string;
  steamName: string;
  perfectName: string | null;
  displayName: string | null;
  primaryPosition: string;
  secondaryPosition: string;
  peakRank: string;
  peakRating: number;
  currentRank: string;
  currentRating: number;
  mapPreferences: MapPreference[];
}

/** Additional fields used only by the authenticated captain operator UI. */
export interface CaptainDraftPlayer extends PublicDraftPlayer {
  registrationId: string;
  /** Tie-break input for the operator-only automatic-pick preview. */
  createdAt: string;
  /** Displayed by the captain-only PlayerInfoPopover. */
  gameplayStyle: string | null;
  /** Displayed by the captain-only PlayerInfoPopover. */
  notes: string | null;
  /** Displayed by the captain-only PlayerInfoPopover. */
  competitionHistory: string | null;
}

export interface DraftLiveState {
  currentRound: number;
  currentEntryId: string | null;
  roundDeadline: string | null;
  isActive: boolean;
}

export interface DraftCompletedPick {
  entryId: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
  round: number;
  pickNumber: number;
  autoPicked: boolean;
}

export interface PublicDraftData {
  state: DraftLiveState | null;
  teams: DraftTeamSlot[];
  snakeOrder: string[];
  remainingPlayers: PublicDraftPlayer[];
  completedPicks: DraftCompletedPick[];
  totalPicks: number;
  maxPicks: number;
}

export interface CaptainDraftData {
  state: DraftLiveState | null;
  teams: DraftTeamSlot[];
  snakeOrder: string[];
  remainingPlayers: CaptainDraftPlayer[];
  completedPicks: DraftCompletedPick[];
  totalPicks: number;
  maxPicks: number;
}

/** Admin control needs state and counts, not the player registration payload. */
export interface DraftAdminData {
  state: DraftLiveState | null;
  teams: DraftTeamSlot[];
  totalPicks: number;
  maxPicks: number;
  remainingPlayerCount: number;
}

interface DraftPlayerSource {
  registrationId: string;
  userId: string;
  steamName: string | null;
  perfectName: string | null;
  displayName: string | null;
  primaryPosition: string;
  secondaryPosition: string;
  peakRank: string;
  peakRating: number | null;
  currentRank: string;
  currentRating: number | null;
  mapPreferences: MapPreference[] | null;
}

interface CaptainDraftPlayerSource extends DraftPlayerSource {
  createdAt: Date;
  gameplayStyle: string | null;
  notes: string | null;
  competitionHistory: string | null;
}

/**
 * Explicitly serialize the spectator contract. Extra query columns are never
 * forwarded by spreading a database row into this object.
 */
export function serializePublicDraftPlayer(row: DraftPlayerSource): PublicDraftPlayer {
  return {
    userId: row.userId,
    steamName: row.steamName ?? "未知选手",
    perfectName: row.perfectName ?? null,
    displayName: row.displayName ?? null,
    primaryPosition: row.primaryPosition,
    secondaryPosition: row.secondaryPosition,
    peakRank: row.peakRank,
    peakRating: row.peakRating ?? 0,
    currentRank: row.currentRank,
    currentRating: row.currentRating ?? 0,
    mapPreferences: row.mapPreferences ?? [],
  };
}

export function serializeCaptainDraftPlayer(
  row: CaptainDraftPlayerSource,
): CaptainDraftPlayer {
  return {
    ...serializePublicDraftPlayer(row),
    registrationId: row.registrationId,
    createdAt: row.createdAt.toISOString(),
    gameplayStyle: row.gameplayStyle ?? null,
    notes: row.notes ?? null,
    competitionHistory: row.competitionHistory ?? null,
  };
}

interface DraftBaseData {
  state: DraftLiveState | null;
  teams: DraftTeamSlot[];
  snakeOrder: string[];
  completedPicks: DraftCompletedPick[];
  totalPicks: number;
  maxPicks: number;
  pickedRegistrationIds: Set<string>;
  captainRegistrationIds: Set<string>;
}

async function loadDraftBase(seasonId: string): Promise<DraftBaseData> {
  const maxPicks = DRAFT_TEAMS * DRAFT_TOTAL_ROUNDS;

  const state = await db.query.draftState.findFirst({
    where: eq(draftState.seasonId, seasonId),
  });

  const draftTeamRows = await db
    .select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      draftOrder: competitionEntries.formationOrder,
      captainRegistrationId: competitionEntries.sourceRegistrationId,
    })
    .from(competitionEntries)
    .where(
      and(
        eq(competitionEntries.competitionId, seasonId),
        isNotNull(competitionEntries.formationOrder),
        isNotNull(competitionEntries.sourceRegistrationId),
      ),
    )
    .orderBy(asc(competitionEntries.formationOrder));
  const teamRows = draftTeamRows.filter(
    (team): team is typeof team & { draftOrder: number; captainRegistrationId: string } =>
      team.draftOrder !== null && team.captainRegistrationId !== null,
  );

  const entryIds = teamRows.map((team) => team.id);
  const allMembers =
    entryIds.length > 0
      ? await db
          .select({
            entryId: eventRosters.entryId,
            registrationId: seasonRegistrations.id,
            steamName: users.steamName,
            perfectName: users.perfectName,
            displayName: users.displayName,
            primaryPosition: seasonRegistrations.primaryPosition,
          })
          .from(eventRosterMembers)
          .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
          .innerJoin(seasonRegistrations, and(
            eq(eventRosterMembers.userId, seasonRegistrations.userId),
            eq(seasonRegistrations.seasonId, seasonId),
          ))
          .leftJoin(users, eq(seasonRegistrations.userId, users.id))
          .where(inArray(eventRosters.entryId, entryIds))
      : [];

  const pickRows = await db
    .select({
      entryId: draftPicks.entryId,
      registrationId: draftPicks.registrationId,
      round: draftPicks.round,
      pickNumber: draftPicks.pickNumber,
      autoPicked: draftPicks.autoPicked,
      steamName: users.steamName,
      displayName: users.displayName,
      perfectName: users.perfectName,
      primaryPosition: seasonRegistrations.primaryPosition,
    })
    .from(draftPicks)
    .innerJoin(
      seasonRegistrations,
      eq(draftPicks.registrationId, seasonRegistrations.id),
    )
    .leftJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(eq(draftPicks.seasonId, seasonId))
    .orderBy(asc(draftPicks.pickNumber));

  const pickedRegistrationIds = new Set(pickRows.map((pick) => pick.registrationId));
  const captainRegistrationIds = new Set(
    teamRows.map((team) => team.captainRegistrationId),
  );

  const membersByTeam = new Map<string, typeof allMembers>();
  for (const member of allMembers) {
    const list = membersByTeam.get(member.entryId) ?? [];
    list.push(member);
    membersByTeam.set(member.entryId, list);
  }

  const picksByRegistrationId = new Map<string, (typeof pickRows)[number]>();
  for (const pick of pickRows) {
    picksByRegistrationId.set(pick.registrationId, pick);
  }

  const draftTeams: DraftTeamSlot[] = teamRows.map((team) => {
    const teamMembersList = membersByTeam.get(team.id) ?? [];
    const captain = teamMembersList.find(
      (member) => member.registrationId === team.captainRegistrationId,
    );
    const draftedMembers = teamMembersList
      .filter((member) => member.registrationId !== team.captainRegistrationId)
      .map((member) => {
        const pick = picksByRegistrationId.get(member.registrationId);
        return {
          steamName: member.steamName ?? "未知选手",
          perfectName: member.perfectName ?? null,
          displayName: member.displayName ?? null,
          primaryPosition: member.primaryPosition,
          pickRound: pick?.round ?? 0,
          pickNumber: pick?.pickNumber ?? 0,
          autoPicked: pick?.autoPicked ?? false,
        };
      })
      .sort((a, b) => a.pickNumber - b.pickNumber);

    return {
      entryId: team.id,
      teamName: team.name,
      draftOrder: team.draftOrder,
      captain: {
        steamName: captain?.steamName ?? "未知队长",
        displayName: captain?.displayName ?? null,
        perfectName: captain?.perfectName ?? null,
        primaryPosition: captain?.primaryPosition ?? "未知",
      },
      members: draftedMembers,
    };
  });

  const snakeOrder = state
    ? getSnakeOrder(
        teamRows.map((team) => ({ id: team.id, draftOrder: team.draftOrder })),
        state.currentRound,
      ).map((team) => team.id)
    : [];

  return {
    state: state
      ? {
          currentRound: state.currentRound,
          currentEntryId: state.currentEntryId,
          roundDeadline: state.roundDeadline?.toISOString() ?? null,
          isActive: state.isActive,
        }
      : null,
    teams: draftTeams,
    snakeOrder,
    completedPicks: pickRows.map((pick) => ({
      entryId: pick.entryId,
      steamName: pick.steamName ?? "未知选手",
      displayName: pick.displayName ?? null,
      perfectName: pick.perfectName ?? null,
      primaryPosition: pick.primaryPosition,
      round: pick.round,
      pickNumber: pick.pickNumber,
      autoPicked: pick.autoPicked,
    })),
    totalPicks: pickRows.length,
    maxPicks,
    pickedRegistrationIds,
    captainRegistrationIds,
  };
}

function remainingRegistrationIds(base: DraftBaseData): string[] {
  return [...new Set([...base.pickedRegistrationIds, ...base.captainRegistrationIds])];
}

async function loadPublicRemainingPlayers(
  seasonId: string,
  base: DraftBaseData,
): Promise<PublicDraftPlayer[]> {
  const rows = await db
    .select({
      registrationId: seasonRegistrations.id,
      userId: seasonRegistrations.userId,
      steamName: users.steamName,
      perfectName: users.perfectName,
      displayName: users.displayName,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      currentRank: seasonRegistrations.currentSeasonPeakRank,
      currentRating: seasonRegistrations.currentRating,
      mapPreferences: seasonRegistrations.mapPreferences,
    })
    .from(seasonRegistrations)
    .leftJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    )
    .orderBy(asc(seasonRegistrations.primaryPosition));

  const excluded = base.pickedRegistrationIds;
  const excludedCaptains = base.captainRegistrationIds;
  return rows
    .filter(
      (row) => !excluded.has(row.registrationId) && !excludedCaptains.has(row.registrationId),
    )
    .map(serializePublicDraftPlayer);
}

async function loadCaptainRemainingPlayers(
  seasonId: string,
  base: DraftBaseData,
): Promise<CaptainDraftPlayer[]> {
  const rows = await db
    .select({
      registrationId: seasonRegistrations.id,
      userId: seasonRegistrations.userId,
      steamName: users.steamName,
      perfectName: users.perfectName,
      displayName: users.displayName,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      currentRank: seasonRegistrations.currentSeasonPeakRank,
      currentRating: seasonRegistrations.currentRating,
      mapPreferences: seasonRegistrations.mapPreferences,
      gameplayStyle: seasonRegistrations.gameplayStyle,
      notes: seasonRegistrations.notes,
      competitionHistory: seasonRegistrations.competitionHistory,
      createdAt: seasonRegistrations.createdAt,
    })
    .from(seasonRegistrations)
    .leftJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    )
    .orderBy(asc(seasonRegistrations.primaryPosition));

  const excluded = new Set(remainingRegistrationIds(base));
  return rows
    .filter((row) => !excluded.has(row.registrationId))
    .map(serializeCaptainDraftPlayer);
}

export async function getPublicDraftData(seasonId: string): Promise<PublicDraftData> {
  const base = await loadDraftBase(seasonId);
  const remainingPlayers = await loadPublicRemainingPlayers(seasonId, base);
  return {
    state: base.state,
    teams: base.teams,
    snakeOrder: base.snakeOrder,
    remainingPlayers,
    completedPicks: base.completedPicks,
    totalPicks: base.totalPicks,
    maxPicks: base.maxPicks,
  };
}

export async function getCaptainDraftData(seasonId: string): Promise<CaptainDraftData> {
  const base = await loadDraftBase(seasonId);
  const remainingPlayers = await loadCaptainRemainingPlayers(seasonId, base);
  return {
    state: base.state,
    teams: base.teams,
    snakeOrder: base.snakeOrder,
    remainingPlayers,
    completedPicks: base.completedPicks,
    totalPicks: base.totalPicks,
    maxPicks: base.maxPicks,
  };
}

export async function getDraftAdminData(seasonId: string): Promise<DraftAdminData> {
  const base = await loadDraftBase(seasonId);
  const remainingIds = remainingRegistrationIds(base);
  const where = [
    eq(seasonRegistrations.seasonId, seasonId),
    eq(seasonRegistrations.status, "approved"),
    ...(remainingIds.length > 0
      ? [notInArray(seasonRegistrations.id, remainingIds)]
      : []),
  ];
  const [remainingRow] = await db
    .select({ count: count() })
    .from(seasonRegistrations)
    .where(and(...where));

  return {
    state: base.state,
    teams: base.teams,
    totalPicks: base.totalPicks,
    maxPicks: base.maxPicks,
    remainingPlayerCount: Number(remainingRow?.count ?? 0),
  };
}
