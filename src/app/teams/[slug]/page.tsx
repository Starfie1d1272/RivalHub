import { Suspense } from "react";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db/client";
import { competitionEntries, matches, recruitmentInterests, seasons, teamCaptainChanges, teamMemberships, teamNameChanges, teamSlugAliases, teams, users } from "@/db/schema";
import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { getUserSession } from "@/lib/auth/session";
import { getPublicTeamRecruitment } from "@/lib/recruitment/data";

const publicName = sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未命名用户')`;

export default function TeamProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<TeamProfileFallback />}>
      <TeamProfileContent params={params} />
    </Suspense>
  );
}

async function TeamProfileContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  let team = await db.query.teams.findFirst({ where: eq(teams.slug, slug) });
  if (!team) {
    const alias = await db.query.teamSlugAliases.findFirst({ where: eq(teamSlugAliases.slug, slug) });
    if (alias) {
      team = await db.query.teams.findFirst({ where: eq(teams.id, alias.teamId) });
      if (team) redirect(`/teams/${team.slug}`);
    }
  }
  if (!team) notFound();
  const session = await getUserSession();
  const [members, names, captains, entries, recruitment] = await Promise.all([
    db.select({ id: teamMemberships.id, userId: users.id, name: publicName, status: teamMemberships.status, startedAt: teamMemberships.startedAt, endedAt: teamMemberships.endedAt }).from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId)).where(eq(teamMemberships.teamId, team!.id)).orderBy(asc(teamMemberships.startedAt)),
    db.select().from(teamNameChanges).where(eq(teamNameChanges.teamId, team!.id)).orderBy(asc(teamNameChanges.changedAt)),
    db.select({ id: teamCaptainChanges.id, name: publicName, changedAt: teamCaptainChanges.changedAt }).from(teamCaptainChanges).innerJoin(users, eq(users.id, teamCaptainChanges.toUserId)).where(eq(teamCaptainChanges.teamId, team!.id)).orderBy(asc(teamCaptainChanges.changedAt)),
    db.select({ id: competitionEntries.id, name: competitionEntries.name, status: competitionEntries.registrationStatus, seasonName: seasons.name, seasonSlug: seasons.slug, createdAt: competitionEntries.createdAt }).from(competitionEntries).innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId)).where(eq(competitionEntries.teamId, team!.id)).orderBy(desc(competitionEntries.createdAt)),
    getPublicTeamRecruitment(team.id),
  ]);
  const entryIds = entries.map((entry) => entry.id);
  const played = entryIds.length ? await db.select({ entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB, status: matches.status }).from(matches).where(and(eq(matches.status, "finished"), or(sql`${matches.entryAId} = ANY(${entryIds}::uuid[])`, sql`${matches.entryBId} = ANY(${entryIds}::uuid[])`))) : [];
  const wins = played.filter((match) => (entryIds.includes(match.entryAId) && (match.scoreA ?? 0) > (match.scoreB ?? 0)) || (entryIds.includes(match.entryBId) && (match.scoreB ?? 0) > (match.scoreA ?? 0))).length;
  const current = members.filter((member) => member.endedAt === null);
  const viewerInterest = session && recruitment ? await db.query.recruitmentInterests.findFirst({ where: and(eq(recruitmentInterests.recruitmentIntentId, recruitment.id), eq(recruitmentInterests.userId, session.userId)), columns: { id: true } }) : null;
  return <div className="container mx-auto max-w-6xl px-4 py-12 sm:py-16"><TeamPublicProfile team={team} currentMembers={current} entries={entries} nameChanges={names} captainChanges={captains} playedCount={played.length} wins={wins} currentUserMembership={session ? current.find((member) => member.userId === session.userId) ?? null : null} recruitment={recruitment} viewerInterested={Boolean(viewerInterest)} loggedIn={Boolean(session)} /></div>;
}

function TeamProfileFallback() {
  return <div className="container mx-auto min-h-[60vh] max-w-6xl px-4 py-12" aria-busy="true" />;
}
