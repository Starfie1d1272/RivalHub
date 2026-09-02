import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { competitiveRankFacts, competitionEntries, recruitmentIntents, recruitmentInterests, seasons, teamMemberships, teams, userCompetitiveRoles, users } from "@/db/schema";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { presentPublicCompetitiveSummary, type PublicCompetitiveProfilePlatform } from "@/lib/competitive/presentation";
import type { Cs2Position } from "@/lib/config/cs2-positions";
import { isTeamRecruitmentTargetAvailable, recruitmentTargetAvailableCondition, teamRecruitmentTargetAvailableCondition } from "@/lib/recruitment/target-policy";

const publicName = sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未知用户')`;

export interface RecruitmentFilters {
  position?: Cs2Position;
  targetSeasonId?: string;
}

export interface PublicRecruitmentIntent {
  id: string;
  positions: Cs2Position[];
  targetSeasonId: string | null;
  targetSeasonName: string | null;
  note: string | null;
  expiresAt: Date;
  updatedAt: Date;
}

export interface TeamRecruitmentCardData extends PublicRecruitmentIntent {
  teamId: string;
  teamSlug: string;
  teamName: string;
  logoUrl: string | null;
  captainName: string;
  memberCount: number;
}

export interface PlayerLftCardData extends PublicRecruitmentIntent {
  userId: string;
  name: string;
  avatarUrl: string | null;
  currentTeamId: string | null;
  competitiveRoles: Cs2Position[];
  currentTeamName: string | null;
  competitiveSummary: PublicCompetitiveProfilePlatform[];
}

function openConditions(kind: "team_recruiting" | "player_lft", filters: RecruitmentFilters) {
  const conditions = [eq(recruitmentIntents.kind, kind), eq(recruitmentIntents.status, "open"), gt(recruitmentIntents.expiresAt, new Date())];
  if (filters.targetSeasonId) conditions.push(eq(recruitmentIntents.targetSeasonId, filters.targetSeasonId));
  if (filters.position) {
    conditions.push(kind === "team_recruiting"
      ? sql`${recruitmentIntents.positions} = ARRAY[]::cs2_role[] OR ${recruitmentIntents.positions} @> ARRAY[${filters.position}]::cs2_role[]`
      : sql`${recruitmentIntents.positions} @> ARRAY[${filters.position}]::cs2_role[]`);
  }
  return conditions;
}

export async function getRecruitmentLobbyData(filters: RecruitmentFilters, viewerUserId?: string | null): Promise<{
  teamRecruitments: TeamRecruitmentCardData[];
  playerLfts: PlayerLftCardData[];
  targetSeasons: Array<{ id: string; name: string }>;
  viewerInterestedIntentIds: Set<string>;
}> {
  const currentPlayerTeam = alias(teams, "recruitment_current_player_team");
  const now = new Date();
  const [teamRows, playerRows, targetSeasons] = await Promise.all([
    db.select({
      id: recruitmentIntents.id,
      positions: recruitmentIntents.positions,
      targetSeasonId: recruitmentIntents.targetSeasonId,
      targetSeasonName: seasons.name,
      note: recruitmentIntents.note,
      expiresAt: recruitmentIntents.expiresAt,
      updatedAt: recruitmentIntents.updatedAt,
      teamId: teams.id,
      teamSlug: teams.slug,
      teamName: teams.name,
      logoUrl: teams.logoUrl,
      captainName: publicName,
    }).from(recruitmentIntents)
      .innerJoin(teams, eq(teams.id, recruitmentIntents.teamId))
      .innerJoin(users, eq(users.id, teams.captainUserId))
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(and(...openConditions("team_recruiting", filters), eq(teams.status, "active"), or(isNull(recruitmentIntents.targetSeasonId), teamRecruitmentTargetAvailableCondition(now, recruitmentIntents.teamId))))
      .orderBy(desc(recruitmentIntents.updatedAt)),
    db.select({
      id: recruitmentIntents.id,
      positions: recruitmentIntents.positions,
      targetSeasonId: recruitmentIntents.targetSeasonId,
      targetSeasonName: seasons.name,
      note: recruitmentIntents.note,
      expiresAt: recruitmentIntents.expiresAt,
      updatedAt: recruitmentIntents.updatedAt,
      userId: users.id,
      name: publicName,
      avatarUrl: users.avatarUrl,
      currentTeamId: currentPlayerTeam.id,
      currentTeamName: currentPlayerTeam.name,
    }).from(recruitmentIntents)
      .innerJoin(users, eq(users.id, recruitmentIntents.userId))
      .leftJoin(teamMemberships, and(eq(teamMemberships.userId, users.id), isNull(teamMemberships.endedAt)))
      .leftJoin(currentPlayerTeam, eq(currentPlayerTeam.id, teamMemberships.teamId))
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(and(...openConditions("player_lft", filters), or(isNull(recruitmentIntents.targetSeasonId), recruitmentTargetAvailableCondition(now))))
      .orderBy(desc(recruitmentIntents.updatedAt)),
    db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(recruitmentTargetAvailableCondition(now)).orderBy(desc(seasons.createdAt)),
  ]);
  const teamIds = teamRows.map((row) => row.teamId);
  const playerIds = [...new Set(playerRows.map((row) => row.userId))];
  const interestIntentIds = teamRows.map((row) => row.id);
  const [memberCounts, roles, interests, rankFacts, competitiveCatalog] = await Promise.all([
    teamIds.length
      ? db.select({ teamId: teamMemberships.teamId, count: sql<number>`count(*)::int` }).from(teamMemberships).where(and(inArray(teamMemberships.teamId, teamIds), isNull(teamMemberships.endedAt))).groupBy(teamMemberships.teamId)
      : Promise.resolve([]),
    playerIds.length
      ? db.select({ userId: userCompetitiveRoles.userId, role: userCompetitiveRoles.role }).from(userCompetitiveRoles).where(inArray(userCompetitiveRoles.userId, playerIds))
      : Promise.resolve([]),
    viewerUserId && interestIntentIds.length
      ? db.select({ recruitmentIntentId: recruitmentInterests.recruitmentIntentId }).from(recruitmentInterests).where(and(eq(recruitmentInterests.userId, viewerUserId), inArray(recruitmentInterests.recruitmentIntentId, interestIntentIds)))
      : Promise.resolve([]),
    playerIds.length
      ? db.select({ id: competitiveRankFacts.id, userId: competitiveRankFacts.userId, platform: competitiveRankFacts.platform, kind: competitiveRankFacts.kind, platformSeasonKey: competitiveRankFacts.platformSeasonKey, status: competitiveRankFacts.status, rank: competitiveRankFacts.rank, rating: competitiveRankFacts.rating, stars: competitiveRankFacts.stars, achievedSeasonKey: competitiveRankFacts.achievedSeasonKey }).from(competitiveRankFacts).where(inArray(competitiveRankFacts.userId, playerIds))
      : Promise.resolve([]),
    playerIds.length ? loadCompetitivePlatformCatalog(db) : Promise.resolve([]),
  ]);
  const countByTeam = new Map(memberCounts.map((row) => [row.teamId, row.count]));
  const rolesByUser = new Map<string, Cs2Position[]>();
  for (const row of roles) rolesByUser.set(row.userId, [...(rolesByUser.get(row.userId) ?? []), row.role]);
  const factsByUser = new Map<string, typeof rankFacts>();
  for (const row of rankFacts) factsByUser.set(row.userId, [...(factsByUser.get(row.userId) ?? []), row]);
  return {
    teamRecruitments: teamRows.map((row) => ({ ...row, positions: row.positions as Cs2Position[], memberCount: countByTeam.get(row.teamId) ?? 0 })),
    playerLfts: playerRows.map((row) => ({ ...row, positions: row.positions as Cs2Position[], competitiveRoles: rolesByUser.get(row.userId) ?? [], competitiveSummary: presentPublicCompetitiveSummary(competitiveCatalog, factsByUser.get(row.userId) ?? []) })),
    targetSeasons,
    viewerInterestedIntentIds: new Set(interests.map((row) => row.recruitmentIntentId)),
  };
}

export async function getPublicTeamRecruitment(teamId: string): Promise<PublicRecruitmentIntent | null> {
  const now = new Date();
  const [intent] = await db.select({ id: recruitmentIntents.id, positions: recruitmentIntents.positions, targetSeasonId: recruitmentIntents.targetSeasonId, targetSeasonName: seasons.name, note: recruitmentIntents.note, expiresAt: recruitmentIntents.expiresAt, updatedAt: recruitmentIntents.updatedAt })
    .from(recruitmentIntents).leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
    .where(and(eq(recruitmentIntents.teamId, teamId), eq(recruitmentIntents.kind, "team_recruiting"), eq(recruitmentIntents.status, "open"), gt(recruitmentIntents.expiresAt, now), or(isNull(recruitmentIntents.targetSeasonId), teamRecruitmentTargetAvailableCondition(now, recruitmentIntents.teamId))))
    .limit(1);
  return intent ? { ...intent, positions: intent.positions as Cs2Position[] } : null;
}

export async function getPublicPlayerLft(userId: string): Promise<PublicRecruitmentIntent | null> {
  const now = new Date();
  const [intent] = await db.select({ id: recruitmentIntents.id, positions: recruitmentIntents.positions, targetSeasonId: recruitmentIntents.targetSeasonId, targetSeasonName: seasons.name, note: recruitmentIntents.note, expiresAt: recruitmentIntents.expiresAt, updatedAt: recruitmentIntents.updatedAt })
    .from(recruitmentIntents).leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
    .where(and(eq(recruitmentIntents.userId, userId), eq(recruitmentIntents.kind, "player_lft"), eq(recruitmentIntents.status, "open"), gt(recruitmentIntents.expiresAt, now), or(isNull(recruitmentIntents.targetSeasonId), recruitmentTargetAvailableCondition(now))))
    .limit(1);
  return intent ? { ...intent, positions: intent.positions as Cs2Position[] } : null;
}

export async function getTeamRecruitmentWorkspace(teamId: string, includeInterests: boolean): Promise<{
  recruitment: (PublicRecruitmentIntent & { status: "open" | "closed"; isPubliclyActive: boolean }) | null;
  targetSeasons: Array<{ id: string; name: string }>;
  interests: Array<{ userId: string; name: string; positions: Cs2Position[] }>;
}> {
  const now = new Date();
  const [intents, targetSeasons] = await Promise.all([
    db.select({ id: recruitmentIntents.id, positions: recruitmentIntents.positions, targetSeasonId: recruitmentIntents.targetSeasonId, targetSeasonName: seasons.name, targetSeasonStatus: seasons.status, targetSeasonRegistrationClosesAt: seasons.registrationClosesAt, targetSeasonRosterChangeClosesAt: seasons.rosterChangeClosesAt, hasEffectiveEntry: sql<boolean>`exists (select 1 from ${competitionEntries} where ${competitionEntries.competitionId} = ${seasons.id} and ${competitionEntries.teamId} = ${teamId} and ${competitionEntries.registrationStatus} not in ('rejected', 'withdrawn'))`, note: recruitmentIntents.note, status: recruitmentIntents.status, expiresAt: recruitmentIntents.expiresAt, updatedAt: recruitmentIntents.updatedAt })
      .from(recruitmentIntents).leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId)).where(and(eq(recruitmentIntents.teamId, teamId), eq(recruitmentIntents.kind, "team_recruiting"))).limit(1),
    db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(teamRecruitmentTargetAvailableCondition(now, sql`${teamId}::uuid`)).orderBy(desc(seasons.createdAt)),
  ]);
  const rawIntent = intents[0];
  const isPubliclyActive = Boolean(rawIntent && rawIntent.status === "open" && rawIntent.expiresAt > now && (!rawIntent.targetSeasonId || (rawIntent.targetSeasonStatus && isTeamRecruitmentTargetAvailable({ status: rawIntent.targetSeasonStatus, registrationClosesAt: rawIntent.targetSeasonRegistrationClosesAt, rosterChangeClosesAt: rawIntent.targetSeasonRosterChangeClosesAt }, rawIntent.hasEffectiveEntry, now))));
  const intent = rawIntent ? { id: rawIntent.id, positions: rawIntent.positions as Cs2Position[], targetSeasonId: rawIntent.targetSeasonId, targetSeasonName: rawIntent.targetSeasonName, note: rawIntent.note, status: rawIntent.status, expiresAt: rawIntent.expiresAt, updatedAt: rawIntent.updatedAt, isPubliclyActive } : null;
  if (!intent || !includeInterests || !isPubliclyActive) return { recruitment: intent, targetSeasons, interests: [] };
  const interestRows = await db.select({ userId: users.id, name: publicName }).from(recruitmentInterests).innerJoin(users, eq(users.id, recruitmentInterests.userId)).where(eq(recruitmentInterests.recruitmentIntentId, intent.id));
  const interestedUserIds = interestRows.map((row) => row.userId);
  const roles = interestedUserIds.length ? await db.select({ userId: userCompetitiveRoles.userId, role: userCompetitiveRoles.role }).from(userCompetitiveRoles).where(inArray(userCompetitiveRoles.userId, interestedUserIds)) : [];
  const rolesByUser = new Map<string, Cs2Position[]>();
  for (const role of roles) rolesByUser.set(role.userId, [...(rolesByUser.get(role.userId) ?? []), role.role]);
  return { recruitment: intent, targetSeasons, interests: interestRows.map((row) => ({ ...row, positions: rolesByUser.get(row.userId) ?? [] })) };
}
