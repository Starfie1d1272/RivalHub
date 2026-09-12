import "server-only";

import { cache } from "react";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { teamInvitations, teamMemberships, teams, users } from "@/db/schema";
import { getPendingDirectTeamInvitations } from "@/lib/teams/invitations";
import { getTeamRecruitmentWorkspace } from "@/lib/recruitment/data";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { loadTeamCompetitionContexts, type MyCompetitionContext } from "@/lib/my/competitions";
import { toLongLivedTeamDto, type LongLivedTeamDto } from "@/lib/teams/workspace";
import type { Cs2Position } from "@/lib/config/cs2-positions";

export interface MyCurrentTeam extends LongLivedTeamDto {
  viewerRole: "captain" | "member";
}

export interface MyTeamMember {
  id: string;
  userId: string;
  name: string;
  status: "active" | "benched" | "left";
}

export interface MyTeamInvitation {
  id: string;
  teamId: string;
  teamName: string;
  email?: string | null;
  expiresAt: string;
}

export interface MyTeamHistory {
  id: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
  status: "active" | "benched" | "left";
  startedAt: string;
  endedAt: string | null;
}

export type MyTeamRecruitment = {
  id: string;
  positions: Cs2Position[];
  targetSeasonId: string | null;
  targetSeasonName: string | null;
  note: string | null;
  status: "open" | "closed";
  expiresAt: string;
  isPubliclyActive: boolean;
} | null;

type TeamWorkspaceShared = {
  team: MyCurrentTeam;
  members: MyTeamMember[];
  competitions: MyCompetitionContext[];
  history: MyTeamHistory[];
};

export type MyTeamWorkspaceModel =
  | {
      kind: "none";
      pendingInvitations: MyTeamInvitation[];
      history: MyTeamHistory[];
    }
  | (TeamWorkspaceShared & {
      kind: "member";
    })
  | (TeamWorkspaceShared & {
      kind: "captain";
      incomingInvitations: MyTeamInvitation[];
      outgoingInvitations: MyTeamInvitation[];
      recruitment: MyTeamRecruitment;
      targetSeasons: Array<{ id: string; name: string }>;
      recruitmentInterests: Array<{ userId: string; name: string; positions: Cs2Position[]; currentTeamName: string | null }>;
    });

export type MembershipPeriod = {
  membership: {
    id: string;
    userId: string;
    status: "active" | "benched" | "left";
    startedAt: Date;
    endedAt: Date | null;
  };
  team: LongLivedTeamDto & { status: "active" | "disbanded" };
};

function presentInvitation(row: { id: string; teamId: string; teamName: string; email?: string | null; expiresAt: Date }): MyTeamInvitation {
  return { ...row, expiresAt: row.expiresAt.toISOString() };
}

export function presentMyTeamHistory(row: MembershipPeriod): MyTeamHistory {
  return {
    id: row.membership.id,
    teamId: row.team.id,
    teamSlug: row.team.slug,
    teamName: row.team.name,
    status: row.membership.status,
    startedAt: row.membership.startedAt.toISOString(),
    endedAt: row.membership.endedAt?.toISOString() ?? null,
  };
}

export const loadMyCurrentTeam = cache(async (userId: string): Promise<MyCurrentTeam | null> => {
  const [row] = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      logoUrl: teams.logoUrl,
      description: teams.description,
      captainUserId: teams.captainUserId,
    })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.endedAt), eq(teams.status, "active")))
    .limit(1);
  if (!row) return null;
  return { ...row, viewerRole: row.captainUserId === userId ? "captain" : "member" };
});

export const loadMyTeamWorkspace = cache(async (userId: string): Promise<MyTeamWorkspaceModel> => {
  const periods = await db
    .select({
      membership: {
        id: teamMemberships.id,
        userId: teamMemberships.userId,
        status: teamMemberships.status,
        startedAt: teamMemberships.startedAt,
        endedAt: teamMemberships.endedAt,
      },
      team: {
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        logoUrl: teams.logoUrl,
        description: teams.description,
        captainUserId: teams.captainUserId,
        status: teams.status,
      },
    })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(eq(teamMemberships.userId, userId))
    .orderBy(desc(teamMemberships.startedAt));

  const current = periods.find((row) => row.membership.endedAt === null && row.team.status === "active") as MembershipPeriod | undefined;
  const history = periods.map((row) => presentMyTeamHistory(row as MembershipPeriod));
  if (!current) {
    const pendingInvitations = await getPendingDirectTeamInvitations(userId);
    return {
      kind: "none",
      pendingInvitations: pendingInvitations.map((row) => presentInvitation(row)),
      history,
    };
  }

  const team = { ...toLongLivedTeamDto(current.team), viewerRole: current.team.captainUserId === userId ? "captain" as const : "member" as const };
  const isCaptain = team.viewerRole === "captain";
  const [memberRows, competitions, recruitmentWorkspace, outgoing] = await Promise.all([
    db.select({
      id: teamMemberships.id,
      userId: teamMemberships.userId,
      displayName: users.displayName,
      perfectName: users.perfectName,
      steamName: users.steamName,
      status: teamMemberships.status,
    }).from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId)).where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.endedAt))),
    loadTeamCompetitionContexts(team.id, userId),
    isCaptain
      ? getTeamRecruitmentWorkspace(team.id, true)
      : Promise.resolve({ recruitment: null, targetSeasons: [], interests: [] }),
    isCaptain
      ? db.select({ id: teamInvitations.id, teamId: teams.id, teamName: teams.name, email: users.email, expiresAt: teamInvitations.expiresAt })
        .from(teamInvitations)
        .innerJoin(teams, eq(teams.id, teamInvitations.teamId))
        .leftJoin(users, eq(users.id, teamInvitations.invitedUserId))
        .where(and(eq(teamInvitations.teamId, team.id), eq(teamInvitations.status, "pending"), gt(teamInvitations.expiresAt, new Date())))
      : Promise.resolve([]),
  ]);

  const members = memberRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: getPublicDisplayName(row),
    status: row.status,
  }));
  const shared = { team, members, competitions, history };
  if (!isCaptain) return { kind: "member", ...shared };
  return {
    kind: "captain",
    ...shared,
    incomingInvitations: [],
    outgoingInvitations: outgoing.map((row) => presentInvitation(row)),
    recruitment: recruitmentWorkspace.recruitment
      ? { ...recruitmentWorkspace.recruitment, expiresAt: recruitmentWorkspace.recruitment.expiresAt.toISOString() }
      : null,
    targetSeasons: recruitmentWorkspace.targetSeasons,
    recruitmentInterests: recruitmentWorkspace.interests,
  };
});
