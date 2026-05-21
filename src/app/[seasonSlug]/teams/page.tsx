import { notFound } from "next/navigation";
import { eq, asc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users, matches, swissStandings } from "@/db/schema";
import { Marker, Stat } from "@/components/rivalhub";
import { TeamCard } from "@/components/teams/TeamCard";
import { calculateStandings } from "@/lib/standings";
import { getSwissDirectoryOrder, sortTeamDirectory } from "@/lib/teams/directory-order";
import { CS2_POSITIONS, getFirstStageOfType, getPreviousStage, normalizeStagePlan } from "@/types/season";
import { getDisplayName } from "@/lib/utils/display-name";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminShortcut } from "@/components/layout/AdminShortcut";

interface TeamsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { seasonSlug } = await params;

  const [season, adminSession] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    checkAdminSession(),
  ]);
  if (!season) notFound();

  const allTeams = await db.query.teams.findMany({
    where: eq(teams.seasonId, season.id),
    orderBy: [asc(teams.draftOrder)],
  });

  if (allTeams.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-[var(--color-fg-mid)]">
        队伍尚未生成，敬请期待
      </div>
    );
  }

  const [allMembers, seasonMatches, seasonSwissStandings, teamStatResult] = await Promise.all([
    db
      .select({
        teamId: teamMembers.teamId,
        registrationId: teamMembers.registrationId,
        captainRegId: teams.captainRegistrationId,
        isStarter: teamMembers.isStarter,
        primaryPosition: seasonRegistrations.primaryPosition,
        steamName: users.steamName,
        perfectName: users.perfectName,
        email: users.email,
        userId: users.id,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
      .innerJoin(users, eq(seasonRegistrations.userId, users.id))
      .where(inArray(teamMembers.teamId, allTeams.map((t) => t.id))),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
    }),
    db.query.swissStandings.findMany({
      where: eq(swissStandings.seasonId, season.id),
      orderBy: [asc(swissStandings.seed)],
    }),
    db.execute(sql`
      SELECT
        tm.team_id,
        count(distinct mps.map_id)::int AS maps,
        round(avg(mps.rating_pro)::numeric, 2) AS avg_rating,
        round(avg(mps.adr)::numeric, 1) AS avg_adr
      FROM match_player_stats mps
      JOIN matches m ON m.id = mps.match_id
      JOIN season_registrations sr
        ON sr.user_id = mps.user_id AND sr.season_id = m.season_id
      JOIN team_members tm ON tm.registration_id = sr.id
      WHERE m.season_id = ${season.id}
        AND mps.verified_by_admin IS NOT NULL
      GROUP BY tm.team_id
    `),
  ]);

  const membersByTeam = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    if (!membersByTeam.has(m.teamId)) membersByTeam.set(m.teamId, []);
    membersByTeam.get(m.teamId)!.push(m);
  }

  const teamRecordMap = new Map<string, { played: number; wins: number; losses: number; winRate: string }>();
  for (const team of allTeams) {
    let wins = 0;
    let losses = 0;
    for (const match of seasonMatches) {
      if (match.status !== "finished") continue;
      if (match.teamAId !== team.id && match.teamBId !== team.id) continue;
      const isTeamA = match.teamAId === team.id;
      const ownScore = isTeamA ? (match.scoreA ?? 0) : (match.scoreB ?? 0);
      const opponentScore = isTeamA ? (match.scoreB ?? 0) : (match.scoreA ?? 0);
      if (ownScore > opponentScore) wins++;
      else losses++;
    }
    const played = wins + losses;
    teamRecordMap.set(team.id, {
      played,
      wins,
      losses,
      winRate: played > 0 ? `${Math.round((wins / played) * 100)}%` : "—",
    });
  }

  const teamSummaryMap = new Map(
    teamStatResult.rows.map((row) => [
      row.team_id as string,
      {
        maps: Number(row.maps),
        avgRating: Number(row.avg_rating),
        avgAdr: Number(row.avg_adr),
      },
    ]),
  );
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const qualifierStage = getFirstStageOfType(stagePlan, ["round_robin", "swiss"]);
  const playoffStage = getFirstStageOfType(stagePlan, ["double_elim", "single_elim"]);
  const qualifierMatches = qualifierStage
    ? seasonMatches.filter((match) => match.stage === qualifierStage.key)
    : [];
  const playoffMatches = playoffStage
    ? seasonMatches.filter((match) => match.stage === playoffStage.key)
    : [];
  const finishedQualifierMatches = qualifierMatches.filter((match) => match.status === "finished");
  const standings = qualifierStage?.type === "round_robin" && finishedQualifierMatches.length > 0
    ? calculateStandings(
        allTeams,
        finishedQualifierMatches,
      )
    : [];
  const qualifierSwissStages = stagePlan.filter((stage) => stage.type === "swiss");
  const activeSwissStage = [...qualifierSwissStages]
    .reverse()
    .find((stage) => seasonSwissStandings.some((standing) => standing.stage === stage.key));
  const activeSwissRows = activeSwissStage
    ? seasonSwissStandings.filter((standing) => standing.stage === activeSwissStage.key)
    : [];
  const standingsOrder = qualifierStage?.type === "swiss"
    ? getSwissDirectoryOrder(activeSwissRows)
    : standings.map((standing) => standing.teamId);
  const isPlayoffDirectory = playoffMatches.length > 0;
  const previousPlayoffStage = playoffStage ? getPreviousStage(stagePlan, playoffStage.key) : null;
  const playoffSeedOrder = previousPlayoffStage?.type === "swiss"
    ? seasonSwissStandings
        .filter((standing) => standing.stage === previousPlayoffStage.key && standing.status === "advanced")
        .sort((a, b) => a.seed - b.seed)
        .map((standing) => standing.teamId)
    : standingsOrder;
  const sortedTeams = sortTeamDirectory(allTeams, {
    mode: isPlayoffDirectory ? "playoff" : "qualifier",
    standingsOrder,
    playoffSeedOrder: isPlayoffDirectory ? playoffSeedOrder : [],
  });
  const orderLabel = isPlayoffDirectory && standingsOrder.length > 0
    ? "正赛种子顺序"
    : standingsOrder.length > 0
      ? "排位赛积分顺序"
      : "选秀顺位";

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl space-y-8">
      <div className="flex items-center justify-between">
        <Marker sub={season.name}>参赛队伍</Marker>
        {adminSession && (
          <AdminShortcut href={`/admin/${seasonSlug}/settings`} label="赛季管理" />
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="TEAMS" value={allTeams.length} />
        <Stat label="PLAYERS" value={allMembers.length} />
        <Stat label="MATCHES" value={`${seasonMatches.filter((match) => match.status === "finished").length}/${seasonMatches.length}`} />
        <Stat label="DATA READY" value={`${teamSummaryMap.size}/${allTeams.length}`} accent />
      </div>

      <div className="space-y-3">
        <p className="text-xs uppercase text-[var(--color-fg-dim)]" style={{ fontFamily: "var(--font-mono)" }}>
          Directory order · {orderLabel}
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sortedTeams.map((team) => {
          const members = (membersByTeam.get(team.id) ?? [])
            .map((m) => ({
              name: getDisplayName(m),
              primaryPosition: m.primaryPosition,
              isStarter: m.isStarter,
              isCaptain: m.registrationId === m.captainRegId,
              userId: m.userId,
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
              logoUrl={team.logoUrl}
              players={members}
              record={teamRecordMap.get(team.id)}
              summary={teamSummaryMap.get(team.id) ?? null}
            />
          );
        })}
        </div>
      </div>
    </div>
  );
}
