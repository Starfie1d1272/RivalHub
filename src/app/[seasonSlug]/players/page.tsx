import { notFound } from "next/navigation";
import { eq, and, asc, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, seasonRegistrations, users } from "@/db/schema";
import { Marker, Stat } from "@/components/rivalhub";
import { PlayerDirectoryRow } from "@/components/players/PlayerDirectoryRow";
import { countDirectoryPlayersWithTeam, sortPlayerDirectory } from "@/lib/players/directory-order";
import { positionLabel, positionValues } from "@/lib/validators/registration";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import type { Metadata } from "next";

interface PlayersPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ position?: string }>;
}

export async function generateMetadata({ params }: PlayersPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getPublicSeasonBySlug(seasonSlug);
  return {
    title: season ? `${season.name} · 选手名单` : "选手名单",
  };
}

export default async function PlayersPage({ params, searchParams }: PlayersPageProps) {
  const { seasonSlug } = await params;
  const { position = "" } = await searchParams;

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

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
    .where(eq(competitionEntries.competitionId, season.id));

  const teamByRegId = new Map(teamMemberRows.flatMap((row) => row.registrationId ? [[row.registrationId, row.teamName] as const] : []));

  const playerStatResult = await db.execute(sql`
    SELECT
      mps.user_id,
      count(distinct mps.map_id)::int AS maps,
      round(avg(mps.rating_pro)::numeric, 2) AS avg_rating,
      -- ADR 回合加权（JOIN match_maps mm2），避免简单均值失真
      round(
        CASE WHEN sum(mm2.score_a + mm2.score_b) > 0
          THEN sum(mps.adr * (mm2.score_a + mm2.score_b))::numeric / sum(mm2.score_a + mm2.score_b)
          ELSE NULL END
      ::numeric, 1) AS avg_adr,
      round((sum(mps.kills)::numeric / nullif(sum(mps.deaths), 0)), 2) AS avg_kd
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm2 ON mm2.id = mps.map_id
    WHERE m.season_id = ${season.id}
      AND mps.verified_by_admin IS NOT NULL
      AND mps.user_id IS NOT NULL
    GROUP BY mps.user_id
  `);
  const statsByUserId = new Map(
    playerStatResult.rows.map((row) => [
      row.user_id as string,
      {
        maps: Number(row.maps),
        avgRating: Number(row.avg_rating),
        avgAdr: Number(row.avg_adr),
        avgKd: row.avg_kd == null ? null : Number(row.avg_kd),
      },
    ]),
  );

  const positionFilters = [
    { value: "", label: "All" },
    ...positionValues.map((p) => ({ value: p, label: positionLabel(p) })),
  ];
  const filteredPlayersWithStats = registrations.filter((reg) => statsByUserId.has(reg.userId)).length;
  const directoryPlayers = sortPlayerDirectory(
    registrations.map((reg) => ({
      userId: reg.userId,
      registrationId: reg.registrationId,
      displayName: getPublicDisplayName(reg),
      name: getPublicDisplayName(reg),
      primaryPosition: reg.primaryPosition,
      secondaryPosition: reg.secondaryPosition,
      peakRank: reg.peakRank,
      peakRating: reg.peakRating,
      currentRank: reg.currentRank,
      currentRating: reg.currentRating,
      teamName: teamByRegId.get(reg.registrationId) ?? null,
      stats: statsByUserId.get(reg.userId) ?? null,
    })),
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl space-y-8">
      <Marker sub={`${season.name} · ${registrations.length} 人已通过审核`}>选手名单</Marker>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="PLAYERS" value={registrations.length} />
        <Stat label="WITH TEAM" value={countDirectoryPlayersWithTeam(registrations, teamByRegId)} />
        <Stat label="DATA READY" value={filteredPlayersWithStats} accent />
        <Stat label="POSITION" value={position ? positionLabel(position) : "ALL"} />
      </div>

      {/* 位置筛选 */}
      <div className="flex gap-2 flex-wrap">
        {positionFilters.map(({ value, label }) => {
          const isActive = position === value;
          const href = value ? `/${seasonSlug}/players?position=${value}` : `/${seasonSlug}/players`;
          return (
            <Link
              key={value}
              href={href as never}
              className={[
                "px-3 py-1.5 rounded text-sm font-medium border transition-colors",
                isActive
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]",
              ].join(" ")}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {registrations.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-fg-mid)]">暂无符合条件的选手</div>
      ) : (
        <div className="space-y-3">
          {directoryPlayers.map((player) => (
            <PlayerDirectoryRow
              key={player.registrationId}
              player={player}
            />
          ))}
        </div>
      )}
    </div>
  );
}
