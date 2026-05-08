import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema/seasons";
import { teams, teamMembers } from "@/db/schema/teams";
import { seasonRegistrations } from "@/db/schema/registrations";
import { users } from "@/db/schema/users";
import { TeamGrid, type TeamCardData } from "@/components/teams/TeamGrid";

interface TeamsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: TeamsPageProps) {
  const { seasonSlug } = await params;
  return { title: `参赛队伍 · ${seasonSlug}` };
}

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const draftDone =
    season.status === "playing" ||
    season.status === "finished" ||
    season.status === "archived";

  if (!draftDone) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="text-5xl mb-6">⏳</div>
        <h1 className="text-2xl font-bold mb-3 text-[var(--text-primary)]">队伍待定</h1>
        <p className="text-[var(--text-secondary)]">
          选秀尚未完成，队伍组建结果将在选秀结束后公布。
        </p>
      </div>
    );
  }

  const seasonTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.seasonId, season.id))
    .orderBy(teams.draftOrder);

  if (seasonTeams.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="text-5xl mb-6">🏆</div>
        <h1 className="text-2xl font-bold mb-3 text-[var(--text-primary)]">暂无队伍</h1>
        <p className="text-[var(--text-secondary)]">该赛季尚未创建队伍。</p>
      </div>
    );
  }

  const teamIds = seasonTeams.map((t) => t.id);

  const allMembers = await db
    .select({
      teamId: teamMembers.teamId,
      registrationId: teamMembers.registrationId,
      isStarter: teamMembers.isStarter,
      primaryPosition: seasonRegistrations.primaryPosition,
      steamName: users.steamName,
    })
    .from(teamMembers)
    .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(inArray(teamMembers.teamId, teamIds));

  const membersByTeam = new Map<string, typeof allMembers>();
  for (const row of allMembers) {
    const list = membersByTeam.get(row.teamId) ?? [];
    list.push(row);
    membersByTeam.set(row.teamId, list);
  }

  const captainMap = new Map(
    allMembers
      .filter((m) => seasonTeams.some((t) => t.captainRegistrationId === m.registrationId))
      .map((m) => [m.registrationId, m.steamName])
  );

  const teamCards: TeamCardData[] = seasonTeams.map((team) => ({
    id: team.id,
    name: team.name,
    draftOrder: team.draftOrder,
    captainSteamName: captainMap.get(team.captainRegistrationId) ?? null,
    members: (membersByTeam.get(team.id) ?? []).map((m) => ({
      steamName: m.steamName,
      primaryPosition: m.primaryPosition,
      isStarter: m.isStarter,
    })),
  }));

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2 text-[var(--text-primary)]">参赛队伍</h1>
      <p className="text-[var(--text-secondary)] mb-8">
        {season.name} · 共 {teamCards.length} 支队伍
      </p>
      <TeamGrid teams={teamCards} seasonSlug={seasonSlug} />
    </div>
  );
}
