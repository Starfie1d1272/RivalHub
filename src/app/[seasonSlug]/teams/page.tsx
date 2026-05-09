import { notFound } from "next/navigation";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users } from "@/db/schema";
import { TeamCard } from "@/components/teams/TeamCard";
import { CS2_POSITIONS } from "@/types/season";

interface TeamsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const allTeams = await db.query.teams.findMany({
    where: eq(teams.seasonId, season.id),
    orderBy: [asc(teams.draftOrder)],
  });

  if (allTeams.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-[var(--text-secondary)]">
        队伍尚未生成，敬请期待
      </div>
    );
  }

  const allMembers = await db
    .select({
      teamId: teamMembers.teamId,
      registrationId: teamMembers.registrationId,
      captainRegId: teams.captainRegistrationId,
      isStarter: teamMembers.isStarter,
      primaryPosition: seasonRegistrations.primaryPosition,
      steamName: users.steamName,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(inArray(teamMembers.teamId, allTeams.map((t) => t.id)));

  const membersByTeam = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    if (!membersByTeam.has(m.teamId)) membersByTeam.set(m.teamId, []);
    membersByTeam.get(m.teamId)!.push(m);
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-8">
      <h1 className="text-3xl font-bold text-[var(--text-primary)]">参赛队伍</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {allTeams.map((team) => {
          const members = (membersByTeam.get(team.id) ?? [])
            .map((m) => ({
              name: m.steamName ?? "未知选手",
              primaryPosition: m.primaryPosition,
              isStarter: m.isStarter,
              isCaptain: m.registrationId === m.captainRegId,
            }))
            .sort((a, b) => {
              if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
              const ai = CS2_POSITIONS.indexOf(a.primaryPosition as never);
              const bi = CS2_POSITIONS.indexOf(b.primaryPosition as never);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });

          return (
            <TeamCard
              key={team.id}
              teamId={team.id}
              teamName={team.name}
              seasonSlug={seasonSlug}
              draftOrder={team.draftOrder}
              players={members}
            />
          );
        })}
      </div>
    </div>
  );
}
