import { ParticipantDirectoryToolbar } from "@/components/season/ParticipantDirectoryToolbar";
import { parseParticipantDirectoryQuery, matchesDirectorySearch } from "@/lib/players/directory-query";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { notFound } from "next/navigation";
import { eq, and, asc, or } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, seasonRegistrations, users } from "@/db/schema";
import { PageHeader, PageLayout, Stat } from "@/components/rivalhub";
import { MajorPlayerDirectoryRow } from "@/components/players/MajorPlayerDirectoryRow";
import { PlayerDirectoryRow } from "@/components/players/PlayerDirectoryRow";
import { countDirectoryPlayersWithTeam, sortPlayerDirectory } from "@/lib/players/directory-order";
import { positionLabel, positionValues } from "@/lib/validators/registration";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantProjection } from "@/lib/major/public-participants";
import { getVerifiedPlayerStatsBySeason } from "@/lib/stats/public-query";
import type { Metadata } from "next";

interface PlayersPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ position?: string; q?: string; team?: string }>;
}

export async function generateMetadata({ params }: PlayersPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getPublicSeasonBySlug(seasonSlug);
  return {
    title: season ? `${season.name} · 选手` : "选手",
  };
}

export default async function PlayersPage({ params, searchParams }: PlayersPageProps) {
  const { seasonSlug } = await params;
  const rawQuery = await searchParams;
  const position = positionValues.includes(rawQuery.position as typeof positionValues[number]) ? rawQuery.position! : "";

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  if (season.competitionTemplate === "major") {
    const projection = await getMajorPublicParticipantProjection(season);
    const teamOptions = [...new Map(projection.players.map((player) => [player.entryId, { id: player.entryId, name: player.entryName }])).values()];
    const query = parseParticipantDirectoryQuery(rawQuery, teamOptions);
    const visiblePlayers = projection.players.filter((player) => (!query.team || query.team === player.entryId) && matchesDirectorySearch(query.q, player.name));
    const playersWithStats = projection.players.filter((player) => player.stats !== null).length;
    const teamCount = projection.teamCount;

    return (
      <PageLayout as="div" variant="wide" className="space-y-8">
        <PageHeader
          title="选手"
          eyebrow={season.name}
          description={projection.presentation.playerDescription}
        />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="选手" value={projection.players.length} />
          <Stat label="所属队伍" value={teamCount} />
          <Stat label="正式比赛数据" value={playersWithStats} accent />
          <Stat label="队伍范围" value={projection.presentation.teamCollectionLabel} />
        </div>

        <ParticipantDirectoryToolbar query={query.q} team={query.team} teams={teamOptions} total={visiblePlayers.length} />
        {visiblePlayers.length === 0 ? (
          <div className="py-16 text-center text-[var(--color-fg-mid)]">暂无符合条件的选手</div>
        ) : (
          <div className="space-y-3">
            {visiblePlayers.map((player) => (
              <MajorPlayerDirectoryRow key={`${player.entryId}-${player.userId}`} player={player} seasonSlug={seasonSlug} />
            ))}
          </div>
        )}
      </PageLayout>
    );
  }

  const whereConditions = position
    ? and(
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.status, "approved"),
        or(
          eq(seasonRegistrations.primaryPosition, position),
          eq(seasonRegistrations.secondaryPosition, position),
        ),
      )
    : and(
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.status, "approved"),
      );

  const registrations = await db
    .select({
      userId: seasonRegistrations.userId,
      registrationId: seasonRegistrations.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      currentRank: seasonRegistrations.currentSeasonPeakRank,
      currentRating: seasonRegistrations.currentRating,
      perfectName: users.perfectName,
      steamName: users.steamName,
      avatarUrl: users.avatarUrl,
    })
    .from(seasonRegistrations)
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(whereConditions)
    .orderBy(asc(seasonRegistrations.primaryPosition), asc(users.perfectName));

  // 查询已有队伍的成员（用于显示队伍归属）
  const teamMemberRows = await db
    .select({
      registrationId: seasonRegistrations.id,
      teamId: competitionEntries.id,
      teamName: competitionEntries.name,
    })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id))
    .leftJoin(seasonRegistrations, and(eq(seasonRegistrations.userId, eventRosterMembers.userId), eq(seasonRegistrations.seasonId, season.id)))
    .where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition()));

  const teamByRegId = new Map(teamMemberRows.flatMap((row) => row.registrationId ? [[row.registrationId, row.teamName] as const] : []));

  const statsByUserId = await getVerifiedPlayerStatsBySeason(
    season.id,
    registrations.map((registration) => registration.userId),
  );

  const filteredPlayersWithStats = registrations.filter((reg) => statsByUserId.has(reg.userId)).length;
  const directoryPlayers = sortPlayerDirectory(
    registrations.map((reg) => ({
      userId: reg.userId,
      registrationId: reg.registrationId,
      displayName: getPublicDisplayName(reg),
      avatarUrl: reg.avatarUrl,
      name: getPublicDisplayName(reg),
      primaryPosition: reg.primaryPosition,
      secondaryPosition: reg.secondaryPosition,
      peakRank: reg.peakRank,
      peakRating: reg.peakRating,
      currentRank: reg.currentRank,
      currentRating: reg.currentRating,
      teamName: teamByRegId.get(reg.registrationId) ?? null,
      teamId: teamMemberRows.find((row) => row.registrationId === reg.registrationId)?.teamId ?? null,
      stats: statsByUserId.get(reg.userId) ?? null,
    })),
  );

  const teamOptions = [...new Map(teamMemberRows.map((row) => [row.teamId, { id: row.teamId, name: row.teamName }])).values()];
  const query = parseParticipantDirectoryQuery(rawQuery, teamOptions);
  const visiblePlayers = directoryPlayers.filter((player) => (!query.team || player.teamId === query.team) && matchesDirectorySearch(query.q, player.displayName));

  return (
    <PageLayout as="div" variant="wide" className="space-y-8">
      <PageHeader
        title="选手"
        eyebrow={season.name}
        description={`${registrations.length} 人已通过审核`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="选手" value={registrations.length} />
        <Stat label="已分配队伍" value={countDirectoryPlayersWithTeam(registrations, teamByRegId)} />
        <Stat label="已有数据" value={filteredPlayersWithStats} accent />
        <Stat label="位置" value={position ? positionLabel(position) : "全部"} />
      </div>

      <ParticipantDirectoryToolbar query={query.q} team={query.team} teams={teamOptions} total={visiblePlayers.length} />

      {visiblePlayers.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-fg-mid)]">暂无符合条件的选手</div>
      ) : (
        <div className="space-y-3">
          {visiblePlayers.map((player) => (
            <PlayerDirectoryRow
              key={player.registrationId}
              player={player}
              seasonSlug={seasonSlug}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
