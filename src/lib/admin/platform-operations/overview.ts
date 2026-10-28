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
  buildTeamSizeDistribution,
  type PlatformOperationsTeamSummary,
  type PlatformOperationsPlayerPool,
  type PlatformOperationsGrowthDay,
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
  const [[activeUsers], [activity], [certifiedUsers]] = await Promise.all([
    db.select({ count: count() }).from(users).where(eq(users.status, "active")),
    db.select({
      day: sql<number>`count(distinct ${userSessions.userId}) filter (where ${userSessions.lastActiveAt} > ${activeUserCutoffs[0]})`,
      week: sql<number>`count(distinct ${userSessions.userId}) filter (where ${userSessions.lastActiveAt} > ${activeUserCutoffs[1]})`,
      month: countDistinct(userSessions.userId),
    }).from(userSessions).innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(eq(users.status, "active"), gt(userSessions.lastActiveAt, activeUserCutoffs[2]!))),
    db.select({ count: countDistinct(educationVerifications.userId) })
      .from(educationVerifications).innerJoin(users, eq(users.id, educationVerifications.userId))
      .where(and(eq(users.status, "active"), eq(educationVerifications.status, "approved"))),
  ]);

  return {
    activeUsers: numberValue(activeUsers?.count),
    activeUsers24h: numberValue(activity?.day),
    activeUsers7d: numberValue(activity?.week),
    activeUsers30d: numberValue(activity?.month),
    certifiedUsers: numberValue(certifiedUsers?.count),
  };
}

async function loadTeamSummary(): Promise<PlatformOperationsTeamSummary> {
  const sizes = db.select({ size: countDistinct(users.id).as("size") }).from(teams)
    .leftJoin(teamMemberships, and(eq(teamMemberships.teamId, teams.id), isNull(teamMemberships.endedAt)))
    .leftJoin(users, and(eq(users.id, teamMemberships.userId), eq(users.status, "active")))
    .where(eq(teams.status, "active")).groupBy(teams.id).as("team_sizes");
  // Exact size histogram, bounded to one row per possible roster size rather than members.
  const histogram = await db.select({ size: sizes.size, count: count() }).from(sizes).groupBy(sizes.size);
  const counts = new Map(histogram.map(row => [numberValue(row.size), numberValue(row.count)]));
  const activeTeamCount = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const sorted = [...counts].sort(([a], [b]) => a - b);
  const atRank = (rank: number) => {
    let seen = 0;
    for (const [size, count] of sorted) { seen += count; if (seen > rank) return size; }
    return 0;
  };
  const buckets = buildTeamSizeDistribution([]).map(bucket => ({ ...bucket,
    count: bucket.key === "10-plus" ? sorted.filter(([size]) => size >= 10).reduce((sum, [, count]) => sum + count, 0)
      : counts.get(Number(bucket.key)) ?? 0,
  }));
  return { activeTeamCount, totalMemberCount: sorted.reduce((sum, [size, count]) => sum + size * count, 0),
    medianTeamSize: activeTeamCount ? (atRank(Math.floor((activeTeamCount - 1) / 2)) + atRank(Math.floor(activeTeamCount / 2))) / 2 : null,
    sizeDistribution: buckets };
}

async function loadPlayerPool(): Promise<Omit<PlatformOperationsPlayerPool, "publicPlayerLft" | "publicTeamRecruiting">> {
  const result = await db.execute(sql`with pool_facts as (
    select exists (select 1 from ${teamMemberships} inner join ${teams} on ${teams.id} = ${teamMemberships.teamId}
      where ${teamMemberships.userId} = ${users.id} and ${teamMemberships.endedAt} is null and ${teams.status} = 'active') as member,
      exists (select 1 from ${educationVerifications} where ${educationVerifications.userId} = ${users.id}
        and ${educationVerifications.status} = 'approved') as certified
    from ${users} where ${users.status} = 'active'
  ) select count(*) filter (where member) as "currentTeamUsers",
    count(*) filter (where certified and not member) as "certifiedWithoutTeam",
    count(*) filter (where member and not certified) as "teamWithoutCertification" from pool_facts`);
  const row = result.rows[0] as { currentTeamUsers: unknown; certifiedWithoutTeam: unknown; teamWithoutCertification: unknown } | undefined;
  return { currentTeamUsers: numberValue(row?.currentTeamUsers), certifiedWithoutTeam: numberValue(row?.certifiedWithoutTeam),
    teamWithoutCertification: numberValue(row?.teamWithoutCertification) };
}

async function loadRecruitmentCounts(now: Date): Promise<{ publicPlayerLft: number; publicTeamRecruiting: number }> {
  const [playerRows, teamRows] = await Promise.all([
    db
      .select({ count: count() })
      .from(recruitmentIntents)
      .innerJoin(users, and(eq(users.id, recruitmentIntents.userId), eq(users.status, "active")))
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(and(
        ...openRecruitmentIntentConditions("player_lft", now),
        or(isNull(recruitmentIntents.targetSeasonId), recruitmentTargetAvailableCondition(now)),
      )),
    db
      .select({ count: count() })
      .from(recruitmentIntents)
      .innerJoin(teams, and(eq(teams.id, recruitmentIntents.teamId), eq(teams.status, "active")))
      .innerJoin(users, and(eq(users.id, teams.captainUserId), eq(users.status, "active")))
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(and(
        ...openRecruitmentIntentConditions("team_recruiting", now),
        or(isNull(recruitmentIntents.targetSeasonId), teamRecruitmentTargetAvailableCondition(now, recruitmentIntents.teamId)),
      )),
  ]);
  return { publicPlayerLft: numberValue(playerRows[0]?.count), publicTeamRecruiting: numberValue(teamRows[0]?.count) };
}

async function loadGrowth(now: Date): Promise<PlatformOperationsGrowthDay[]> {
  const start = getPlatformOperationsGrowthStart(now);
  // Historical events deliberately ignore current user/team/membership lifecycle.
  const userDay = sql<string>`to_char(${users.createdAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`;
  const educationDay = sql<string>`to_char(${educationVerifications.reviewedAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`;
  const teamDay = sql<string>`to_char(${teams.createdAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`;
  const membershipDay = sql<string>`to_char(${teamMemberships.startedAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`;
  const [newUsers, approvals, newTeams, memberships] = await Promise.all([
    db.select({ day: userDay, count: count() }).from(users)
      .where(and(gte(users.createdAt, start), lt(users.createdAt, now))).groupBy(userDay),
    db.select({ day: educationDay, count: countDistinct(educationVerifications.userId) }).from(educationVerifications)
      .where(and(eq(educationVerifications.status, "approved"), isNotNull(educationVerifications.reviewedAt),
        gte(educationVerifications.reviewedAt, start), lt(educationVerifications.reviewedAt, now))).groupBy(educationDay),
    db.select({ day: teamDay, count: count() }).from(teams)
      .where(and(gte(teams.createdAt, start), lt(teams.createdAt, now))).groupBy(teamDay),
    db.select({ day: membershipDay, count: count() }).from(teamMemberships)
      .where(and(gte(teamMemberships.startedAt, start), lt(teamMemberships.startedAt, now))).groupBy(membershipDay),
  ]);
  const days = buildPlatformOperationsGrowth(now, []);
  const collections = [[newUsers, "newUsers"], [approvals, "newEducationApprovals"], [newTeams, "newTeams"], [memberships, "newMemberships"]] as const;
  for (const [rows, key] of collections) {
    const counts = new Map(rows.map(row => [row.day, numberValue(row.count)]));
    for (const day of days) day[key] = counts.get(day.date) ?? 0;
  }
  return days;
}

export async function getPlatformOperationsOverview(now = new Date()): Promise<PlatformOperationsOverview> {
  const [population, teamSummary, playerPool, recruitment, growth] = await Promise.all([
      loadPopulation(now), loadTeamSummary(), loadPlayerPool(), loadRecruitmentCounts(now), loadGrowth(now),
    ]);
  return { asOf: now.toISOString(), population: { ...population, activeTeams: teamSummary.activeTeamCount },
    playerPool: { ...playerPool, ...recruitment }, teams: teamSummary, growth };
}
