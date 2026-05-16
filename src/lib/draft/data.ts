import { eq, and, asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  draftState,
  draftPicks,
  teams,
  teamMembers,
  seasonRegistrations,
  users,
} from "@/db/schema";
import { DRAFT_TEAMS, DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import type { MapPreference } from "@/types/season";
import { getSnakeOrder } from "./rules";

// ── 数据类型 ─────────────────────────────────────────────

export interface DraftTeamSlot {
  teamId: string;
  teamName: string;
  draftOrder: number;
  captain: { steamName: string; displayName: string | null; perfectName: string | null; primaryPosition: string };
  members: {
    registrationId: string;
    steamName: string;
    perfectName: string | null;
    displayName: string | null;
    primaryPosition: string;
    pickRound: number;
    pickNumber: number;
    autoPicked: boolean;
  }[];
}

export interface DraftPlayerRow {
  registrationId: string;
  userId: string;
  steamName: string;
  perfectName: string | null;
  displayName: string | null;
  email: string | null;
  primaryPosition: string;
  secondaryPosition: string;
  peakRank: string;
  peakRating: number;
  mapPreferences: MapPreference[];
  gameplayStyle: string | null;
  notes: string | null;
  competitionHistory: string | null;
}

export interface DraftLiveState {
  currentRound: number;
  currentTeamId: string | null;
  roundDeadline: string | null; // ISO string
  isActive: boolean;
}

export interface DraftFullData {
  state: DraftLiveState | null;
  teams: DraftTeamSlot[];
  snakeOrder: string[]; // team IDs in snake order for the current round
  remainingPlayers: DraftPlayerRow[];
  completedPicks: {
    teamId: string;
    registrationId: string;
    steamName: string;
    displayName: string | null;
    perfectName: string | null;
    primaryPosition: string;
    round: number;
    pickNumber: number;
    autoPicked: boolean;
  }[];
  totalPicks: number;
  maxPicks: number; // DRAFT_TEAMS * total rounds
}

// ── 查询函数 ─────────────────────────────────────────────

export async function getDraftData(seasonId: string): Promise<DraftFullData> {
  const maxPicks = DRAFT_TEAMS * DRAFT_TOTAL_ROUNDS;

  // 1. 选秀状态
  const state = await db.query.draftState.findFirst({
    where: eq(draftState.seasonId, seasonId),
  });

  // 2. 所有队伍 + 队员
  const teamRows = await db
    .select()
    .from(teams)
    .where(eq(teams.seasonId, seasonId))
    .orderBy(asc(teams.draftOrder));

  const teamIds = teamRows.map((team) => team.id);
  const allMembers =
    teamIds.length > 0
      ? await db
          .select({
            teamId: teamMembers.teamId,
            registrationId: teamMembers.registrationId,
            isStarter: teamMembers.isStarter,
            steamName: users.steamName,
            perfectName: users.perfectName,
            displayName: users.displayName,
            primaryPosition: seasonRegistrations.primaryPosition,
          })
          .from(teamMembers)
          .innerJoin(
            seasonRegistrations,
            eq(teamMembers.registrationId, seasonRegistrations.id),
          )
          .leftJoin(users, eq(seasonRegistrations.userId, users.id))
          .where(inArray(teamMembers.teamId, teamIds))
      : [];

  // 3. 所有 picks
  const pickRows = await db
    .select({
      id: draftPicks.id,
      teamId: draftPicks.teamId,
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

  const pickedRegIds = new Set(pickRows.map((p) => p.registrationId));

  // 4. 剩余可选选手（approved 且未被选，不含已是队长的）
  const captainRegIds = new Set(
    teamRows.map((t) => t.captainRegistrationId),
  );

  const remainingRows = await db
    .select({
      registrationId: seasonRegistrations.id,
      userId: seasonRegistrations.userId,
      steamName: users.steamName,
      perfectName: users.perfectName,
      displayName: users.displayName,
      email: users.email,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      mapPreferences: seasonRegistrations.mapPreferences,
      gameplayStyle: seasonRegistrations.gameplayStyle,
      notes: seasonRegistrations.notes,
      competitionHistory: seasonRegistrations.competitionHistory,
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

  const remainingPlayers: DraftPlayerRow[] = remainingRows
    .filter((r) => !pickedRegIds.has(r.registrationId) && !captainRegIds.has(r.registrationId))
    .map((r) => ({
      registrationId: r.registrationId,
      userId: r.userId,
      steamName: r.steamName ?? "未知选手",
      perfectName: r.perfectName ?? null,
      displayName: r.displayName ?? null,
      email: r.email ?? null,
      primaryPosition: r.primaryPosition,
      secondaryPosition: r.secondaryPosition,
      peakRank: r.peakRank,
      peakRating: r.peakRating ?? 0,
      mapPreferences: r.mapPreferences ?? [],
      gameplayStyle: r.gameplayStyle ?? null,
      notes: r.notes ?? null,
      competitionHistory: r.competitionHistory ?? null,
    }));

  // 5. 组装队伍数据
  const membersByTeam = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push(m);
    membersByTeam.set(m.teamId, list);
  }

  const picksByRegId = new Map<string, (typeof pickRows)[number]>();
  for (const p of pickRows) {
    picksByRegId.set(p.registrationId, p);
  }

  const draftTeams: DraftTeamSlot[] = teamRows.map((t) => {
    const teamMembersList = membersByTeam.get(t.id) ?? [];
    const captain = teamMembersList.find(
      (m) => m.registrationId === t.captainRegistrationId,
    );
    const drafted = teamMembersList
      .filter((m) => m.registrationId !== t.captainRegistrationId)
      .map((m) => {
        const pick = picksByRegId.get(m.registrationId);
        return {
          registrationId: m.registrationId,
          steamName: m.steamName ?? "未知选手",
          perfectName: m.perfectName ?? null,
          displayName: m.displayName ?? null,
          primaryPosition: m.primaryPosition,
          pickRound: pick?.round ?? 0,
          pickNumber: pick?.pickNumber ?? 0,
          autoPicked: pick?.autoPicked ?? false,
        };
      })
      .sort((a, b) => a.pickNumber - b.pickNumber);

    return {
      teamId: t.id,
      teamName: t.name,
      draftOrder: t.draftOrder,
      captain: {
        steamName: captain?.steamName ?? "未知队长",
        displayName: captain?.displayName ?? null,
        perfectName: captain?.perfectName ?? null,
        primaryPosition: captain?.primaryPosition ?? "未知",
      },
      members: drafted,
    };
  });

  // 6. 蛇形顺序
  const snakeOrder = state
    ? getSnakeOrder(
        teamRows.map((t) => ({ id: t.id, draftOrder: t.draftOrder })),
        state.currentRound,
      ).map((t) => t.id)
    : [];

  return {
    state: state
      ? {
          currentRound: state.currentRound,
          currentTeamId: state.currentTeamId,
          roundDeadline: state.roundDeadline?.toISOString() ?? null,
          isActive: state.isActive,
        }
      : null,
    teams: draftTeams,
    snakeOrder,
    remainingPlayers,
    completedPicks: pickRows.map((p) => ({
      teamId: p.teamId,
      registrationId: p.registrationId,
      steamName: p.steamName ?? "未知选手",
      displayName: p.displayName ?? null,
      perfectName: p.perfectName ?? null,
      primaryPosition: p.primaryPosition,
      round: p.round,
      pickNumber: p.pickNumber,
      autoPicked: p.autoPicked,
    })),
    totalPicks: pickRows.length,
    maxPicks,
  };
}
