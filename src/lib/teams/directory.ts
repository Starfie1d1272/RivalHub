import "server-only";

import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { recruitmentIntents, seasons, teamMemberships, teams, users } from "@/db/schema";
import { escapeLikePattern } from "@/lib/db/search";
import { teamRecruitmentTargetAvailableCondition } from "@/lib/recruitment/target-policy";
import type { TeamDirectoryQuery } from "./directory-contract";

export type { TeamDirectoryQuery } from "./directory-contract";

export interface TeamDirectoryRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  hasOpenRecruitment: boolean;
  status: "active" | "disbanded";
  captainName: string;
  memberCount: number;
}

export interface TeamDirectoryData {
  rows: TeamDirectoryRow[];
  total: number;
  hasAnyTeams: boolean;
  normalizedQuery: TeamDirectoryQuery;
}

const captainName = sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未命名用户')`;

export async function getTeamDirectory(query: TeamDirectoryQuery): Promise<TeamDirectoryData> {
  const now = new Date();
  const memberCounts = db
    .select({ teamId: teamMemberships.teamId, memberCount: sql<number>`count(*)::int`.as("member_count") })
    .from(teamMemberships)
    .where(isNull(teamMemberships.endedAt))
    .groupBy(teamMemberships.teamId)
    .as("team_directory_member_counts");
  const openRecruitment = and(
    eq(recruitmentIntents.teamId, teams.id),
    eq(recruitmentIntents.kind, "team_recruiting"),
    eq(recruitmentIntents.status, "open"),
    gt(recruitmentIntents.expiresAt, now),
    eq(teams.status, "active"),
  );
  const recruitmentTargetAvailable = or(
    isNull(recruitmentIntents.targetSeasonId),
    teamRecruitmentTargetAvailableCondition(now, teams.id),
  );
  const statusCondition = eq(teams.status, query.status === "active" ? "active" : "disbanded");
  const conditions = [statusCondition];
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    conditions.push(or(ilike(teams.name, pattern), ilike(captainName, pattern))!);
  }
  if (query.recruiting) conditions.push(and(isNotNull(recruitmentIntents.id), recruitmentTargetAvailable)!);
  const where = and(...conditions);
  const hasOpenRecruitment = sql<boolean>`${recruitmentIntents.id} IS NOT NULL AND ${recruitmentTargetAvailable}`;
  const memberCount = sql<number>`coalesce(${memberCounts.memberCount}, 0)::int`;
  const orderBy = query.sort === "name"
    ? [asc(teams.name), asc(teams.id)]
    : query.sort === "members_asc"
      ? [asc(memberCount), asc(teams.name), asc(teams.id)]
      : query.sort === "members_desc"
        ? [desc(memberCount), asc(teams.name), asc(teams.id)]
        : [desc(hasOpenRecruitment), asc(teams.name), asc(teams.id)];

  const [rows, [totalRow], [allTeamsRow]] = await Promise.all([
    db.select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      logoUrl: teams.logoUrl,
      description: teams.description,
      hasOpenRecruitment,
      status: teams.status,
      captainName,
      memberCount,
    })
      .from(teams)
      .innerJoin(users, eq(users.id, teams.captainUserId))
      .leftJoin(recruitmentIntents, openRecruitment)
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .leftJoin(memberCounts, eq(memberCounts.teamId, teams.id))
      .where(where)
      .orderBy(...orderBy),
    db.select({ count: count() })
      .from(teams)
      .innerJoin(users, eq(users.id, teams.captainUserId))
      .leftJoin(recruitmentIntents, openRecruitment)
      .leftJoin(seasons, eq(seasons.id, recruitmentIntents.targetSeasonId))
      .where(where),
    db.select({ count: count() }).from(teams),
  ]);

  return {
    rows,
    total: Number(totalRow?.count ?? 0),
    hasAnyTeams: Number(allTeamsRow?.count ?? 0) > 0,
    normalizedQuery: query,
  };
}
