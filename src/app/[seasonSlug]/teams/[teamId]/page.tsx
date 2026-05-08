import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema/seasons";
import { teams, teamMembers } from "@/db/schema/teams";
import { seasonRegistrations } from "@/db/schema/registrations";
import { users } from "@/db/schema/users";
import { TeamRosterCard, type RosterMember } from "@/components/teams/TeamRosterCard";

interface TeamDetailPageProps {
  params: Promise<{ seasonSlug: string; teamId: string }>;
}

export async function generateMetadata({ params }: TeamDetailPageProps) {
  const { teamId } = await params;
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  return { title: team ? `${team.name} · 阵容` : "队伍详情" };
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { seasonSlug, teamId } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
  });
  if (!team || team.seasonId !== season.id) notFound();

  const memberRows = await db
    .select({
      memberId: teamMembers.id,
      isStarter: teamMembers.isStarter,
      registrationId: teamMembers.registrationId,
      primaryPosition: seasonRegistrations.primaryPosition,
      peakRank: seasonRegistrations.peakRank,
      currentRating: seasonRegistrations.currentRating,
      steamName: users.steamName,
    })
    .from(teamMembers)
    .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));

  const POSITION_ORDER = ["igl", "awper", "opener", "closer", "anchor"];

  const rosterMembers: RosterMember[] = memberRows
    .sort((a, b) => {
      const ai = POSITION_ORDER.indexOf(a.primaryPosition);
      const bi = POSITION_ORDER.indexOf(b.primaryPosition);
      if (ai !== bi) return ai - bi;
      return a.isStarter ? -1 : 1;
    })
    .map((m) => ({
      id: m.memberId,
      steamName: m.steamName,
      primaryPosition: m.primaryPosition,
      peakRank: m.peakRank,
      currentRating: m.currentRating,
      isStarter: m.isStarter,
      isCaptain: m.registrationId === team.captainRegistrationId,
    }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <TeamRosterCard
        teamName={team.name}
        draftOrder={team.draftOrder}
        seasonSlug={seasonSlug}
        members={rosterMembers}
      />
    </div>
  );
}
