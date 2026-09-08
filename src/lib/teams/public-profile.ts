import "server-only";

import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  competitionEntries,
  matches,
  recruitmentInterests,
  seasons,
  teamCaptainChanges,
  teamMemberships,
  teamNameChanges,
  teamSlugAliases,
  teams,
  users,
} from "@/db/schema";
import {
  publicCompetitionEntryCondition,
} from "@/lib/competition-entries/public-visibility";
import {
  type CompetitionEntryRegistrationStatus,
} from "@/lib/competition-entries/presentation";
import { getPublicTeamRecruitment, type PublicRecruitmentIntent } from "@/lib/recruitment/data";

const publicName = sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未知用户')`;

export type PublicTeamMembershipStatus = "active" | "benched";

export interface PublicTeamIdentity {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  status: "active" | "disbanded";
  captainUserId: string;
}

export interface PublicTeamProfile {
  team: PublicTeamIdentity;
  currentMembers: Array<{
    id: string;
    userId: string;
    name: string;
    status: PublicTeamMembershipStatus;
  }>;
  entries: Array<{
    id: string;
    name: string;
    status: CompetitionEntryRegistrationStatus;
    seasonName: string;
    seasonSlug: string;
    createdAt: Date;
  }>;
  nameChanges: Array<{
    id: string;
    oldName: string | null;
    newName: string;
    changedAt: Date;
  }>;
  captainChanges: Array<{
    id: string;
    name: string;
    changedAt: Date;
  }>;
  playedCount: number;
  wins: number;
  currentUserMembership: {
    userId: string;
    status: PublicTeamMembershipStatus;
  } | null;
  recruitment: PublicRecruitmentIntent | null;
  viewerInterested: boolean;
  loggedIn: boolean;
}

/** Resolve a public Team URL, including the existing slug-alias redirect path. */
export async function resolvePublicTeamProfileTarget(slug: string): Promise<PublicTeamIdentity | null> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.slug, slug),
    columns: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      description: true,
      status: true,
      captainUserId: true,
    },
  });
  if (team) return team;

  const alias = await db.query.teamSlugAliases.findFirst({
    where: eq(teamSlugAliases.slug, slug),
    columns: { teamId: true },
  });
  if (!alias) return null;

  return (await db.query.teams.findFirst({
    where: eq(teams.id, alias.teamId),
    columns: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      description: true,
      status: true,
      captainUserId: true,
    },
  })) ?? null;
}

export async function getPublicTeamProfile(
  teamId: string,
  viewerUserId?: string | null,
  knownTeam?: PublicTeamIdentity,
): Promise<PublicTeamProfile | null> {
  const team = knownTeam?.id === teamId
    ? knownTeam
    : await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
      columns: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        description: true,
        status: true,
        captainUserId: true,
      },
    });
  if (!team) return null;

  const [members, names, captains, entries, recruitment] = await Promise.all([
    db
      .select({
        id: teamMemberships.id,
        userId: users.id,
        name: publicName,
        status: teamMemberships.status,
        endedAt: teamMemberships.endedAt,
      })
      .from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(eq(teamMemberships.teamId, team.id))
      .orderBy(asc(teamMemberships.startedAt)),
    db
      .select({
        id: teamNameChanges.id,
        oldName: teamNameChanges.oldName,
        newName: teamNameChanges.newName,
        changedAt: teamNameChanges.changedAt,
      })
      .from(teamNameChanges)
      .where(eq(teamNameChanges.teamId, team.id))
      .orderBy(asc(teamNameChanges.changedAt)),
    db
      .select({ id: teamCaptainChanges.id, name: publicName, changedAt: teamCaptainChanges.changedAt })
      .from(teamCaptainChanges)
      .innerJoin(users, eq(users.id, teamCaptainChanges.toUserId))
      .where(eq(teamCaptainChanges.teamId, team.id))
      .orderBy(asc(teamCaptainChanges.changedAt)),
    db
      .select({
        id: competitionEntries.id,
        name: competitionEntries.name,
        status: competitionEntries.registrationStatus,
        seasonName: seasons.name,
        seasonSlug: seasons.slug,
        createdAt: competitionEntries.createdAt,
      })
      .from(competitionEntries)
      .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
      .where(and(
        eq(competitionEntries.teamId, team.id),
        ne(seasons.status, "draft"),
        publicCompetitionEntryCondition(),
      ))
      .orderBy(desc(competitionEntries.createdAt)),
    getPublicTeamRecruitment(team.id),
  ]);

  const currentMembers = members
    .filter((member): member is typeof member & { status: PublicTeamMembershipStatus } => member.endedAt === null && member.status !== "left")
    .map(({ id, userId, name, status }) => ({ id, userId, name, status }));
  const entryIds = entries.map((entry) => entry.id);
  const played = entryIds.length
    ? await db
      .select({ entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB })
      .from(matches)
      .where(and(
        eq(matches.status, "finished"),
        or(inArray(matches.entryAId, entryIds), inArray(matches.entryBId, entryIds)),
      ))
    : [];
  const wins = played.filter((match) => {
    const isA = entryIds.includes(match.entryAId);
    const ownScore = isA ? match.scoreA : match.scoreB;
    const opponentScore = isA ? match.scoreB : match.scoreA;
    return ownScore !== null && opponentScore !== null && ownScore > opponentScore;
  }).length;
  const currentUserMembership = viewerUserId
    ? currentMembers.find((member) => member.userId === viewerUserId) ?? null
    : null;
  const viewerInterest = viewerUserId && recruitment
    ? await db.query.recruitmentInterests.findFirst({
      where: and(
        eq(recruitmentInterests.recruitmentIntentId, recruitment.id),
        eq(recruitmentInterests.userId, viewerUserId),
      ),
      columns: { id: true },
    })
    : null;

  return {
    team,
    currentMembers,
    entries,
    nameChanges: names,
    captainChanges: captains,
    playedCount: played.length,
    wins,
    currentUserMembership,
    recruitment,
    viewerInterested: Boolean(viewerInterest),
    loggedIn: Boolean(viewerUserId),
  };
}
