import "server-only";

import { and, count, countDistinct, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  educationVerifications,
  recruitmentIntents,
  seasons,
  teamMemberships,
  teams,
  userSessions,
  users,
} from "@/db/schema";
import {
  openRecruitmentIntentConditions,
} from "@/lib/recruitment/data";
import {
  recruitmentTargetAvailableCondition,
  teamRecruitmentTargetAvailableCondition,
} from "@/lib/recruitment/target-policy";
import {
  buildPlatformOperationsGrowth,
  getPlatformOperationsGrowthStart,
  summarizePlayerPool,
  summarizeTeamSizes,
  type PlatformOperationsCurrentMembershipRow,
  type PlatformOperationsGrowthEvent,
  type PlatformOperationsOverview,
} from "./types";

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadPopulation(now: Date) {
  const activeUserCutoffs = [
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
    new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  ];
  const [[activeUsers], [activeUsers24h], [activeUsers7d], [activeUsers30d], [certifiedUsers]] = await Promise.all([
    db.select({ count: count() }).from(users).where(eq(users.status, "active")),
    db.select({ count: countDistinct(userSessions.userId) })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(eq(users.status, "active"), gt(userSessions.lastActiveAt, activeUserCutoffs[0]!))),
    db.select({ count: countDistinct(userSessions.userId) })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(eq(users.status, "active"), gt(userSessions.lastActiveAt, activeUserCutoffs[1]!))),
    db.select({ count: countDistinct(userSessions.userId) })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(eq(users.status, "active"), gt(userSessions.lastActiveAt, activeUserCutoffs[2]!))),
    db.select({ count: countDistinct(educationVerifications.userId) })
      .from(educationVerifications)
      .innerJoin(users, eq(users.id, educationVerifications.userId))
      .where(and(eq(users.status, "active"), eq(educationVerifications.status, "approved"))),
  ]);

  return {
    activeUsers: numberValue(activeUsers?.count),
    activeUsers24h: numberValue(activeUsers24h?.count),
    activeUsers7d: numberValue(activeUsers7d?.count),
    activeUsers30d: numberValue(activeUsers30d?.count),
    certifiedUsers: numberValue(certifiedUsers?.count),
  };
}

async function loadCurrentMemberships(): Promise<PlatformOperationsCurrentMembershipRow[]> {
  return db
    .select({
      teamId: teams.id,
      userId: sql<string | null>`CASE WHEN ${users.id} IS NOT NULL THEN ${teamMemberships.userId} ELSE NULL END`,
    })
    .from(teams)
    .leftJoin(teamMemberships, and(eq(teamMemberships.teamId, teams.id), isNull(teamMemberships.endedAt)))
    .leftJoin(users, and(eq(users.id, teamMemberships.userId), eq(users.status, "active")))
    .where(eq(teams.status, "active"));
}

async function loadCertifiedUserIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: educationVerifications.userId })
    .from(educationVerifications)
    .innerJoin(users, eq(users.id, educationVerifications.userId))
    .where(and(eq(users.status, "active"), eq(educationVerifications.status, "approved")));
  return rows.map((row) => row.userId);
}

async function loadRecruitmentCounts(now: Date): Promise<{ publicPlayerLft: number; publicTeamRecruiting: number }> {
  const [playerRows, teamRows] = await Promise.all([
    db
      .select({ id: recruitmentIntents.id })
      .from(recruitmentIntents)
      .innerJoin(users, and(eq(users.id, recruitmentIntents.userId), eq(users.status, "active")))
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(and(
        ...openRecruitmentIntentConditions("player_lft", now),
        or(isNull(recruitmentIntents.targetSeasonId), recruitmentTargetAvailableCondition(now)),
      )),
    db
      .select({ id: recruitmentIntents.id })
      .from(recruitmentIntents)
      .innerJoin(teams, and(eq(teams.id, recruitmentIntents.teamId), eq(teams.status, "active")))
      .innerJoin(users, and(eq(users.id, teams.captainUserId), eq(users.status, "active")))
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(and(
        ...openRecruitmentIntentConditions("team_recruiting", now),
        or(isNull(recruitmentIntents.targetSeasonId), teamRecruitmentTargetAvailableCondition(now, recruitmentIntents.teamId)),
      )),
  ]);
  return { publicPlayerLft: playerRows.length, publicTeamRecruiting: teamRows.length };
}

async function loadGrowthEvents(now: Date): Promise<PlatformOperationsGrowthEvent[]> {
  const start = getPlatformOperationsGrowthStart(now);
  // Growth is an event trend. Current lifecycle/status filters would erase
  // historical creations after a user merge, Team disband, or membership end.
  const [newUsers, educationApprovals, newTeams, newMemberships] = await Promise.all([
    db
      .select({ entityId: users.id, occurredAt: users.createdAt })
      .from(users)
      .where(and(gte(users.createdAt, start), lt(users.createdAt, now))),
    db
      .select({ entityId: educationVerifications.userId, occurredAt: educationVerifications.reviewedAt })
      .from(educationVerifications)
      .where(and(
        eq(educationVerifications.status, "approved"),
        isNotNull(educationVerifications.reviewedAt),
        gte(educationVerifications.reviewedAt, start),
        lt(educationVerifications.reviewedAt, now),
      )),
    db
      .select({ entityId: teams.id, occurredAt: teams.createdAt })
      .from(teams)
      .where(and(gte(teams.createdAt, start), lt(teams.createdAt, now))),
    db
      .select({ entityId: teamMemberships.id, occurredAt: teamMemberships.startedAt })
      .from(teamMemberships)
      .where(and(
        gte(teamMemberships.startedAt, start),
        lt(teamMemberships.startedAt, now),
      )),
  ]);

  return [
    ...newUsers.map((row) => ({ kind: "user_created" as const, ...row })),
    ...educationApprovals.flatMap((row) => row.occurredAt
      ? [{ kind: "education_approval" as const, entityId: row.entityId, occurredAt: row.occurredAt }]
      : []),
    ...newTeams.map((row) => ({ kind: "team_created" as const, ...row })),
    ...newMemberships.map((row) => ({ kind: "membership_started" as const, ...row })),
  ];
}

export async function getPlatformOperationsOverview(now = new Date()): Promise<PlatformOperationsOverview> {
  const [population, currentMemberships, certifiedUserIds, recruitment, growthEvents] = await Promise.all([
    loadPopulation(now),
    loadCurrentMemberships(),
    loadCertifiedUserIds(),
    loadRecruitmentCounts(now),
    loadGrowthEvents(now),
  ]);
  const teamSummary = summarizeTeamSizes(currentMemberships);

  return {
    asOf: now.toISOString(),
    population: { ...population, activeTeams: teamSummary.activeTeamCount },
    playerPool: summarizePlayerPool({ currentMemberships, certifiedUserIds, ...recruitment }),
    teams: teamSummary,
    growth: buildPlatformOperationsGrowth(now, growthEvents),
  };
}
