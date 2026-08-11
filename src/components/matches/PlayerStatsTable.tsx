import React from "react";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { teamMembers } from "@/db/schema/teams";
import { seasonRegistrations } from "@/db/schema/registrations";
import { MatchSummaryStats, type SummaryPlayer } from "./MatchSummaryStats";

interface PlayerStatsTableProps {
  mapId: string;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  seasonId: string;
  seasonSlug: string;
}

async function getStatsGroupedByTeam(
  mapId: string,
  teamAId: string,
  teamBId: string,
  seasonId: string,
) {
  const stats = await db.query.matchPlayerStats.findMany({
    where: eq(matchPlayerStats.mapId, mapId),
    orderBy: (t, { desc }) => [desc(t.ratingPro)],
  });

  if (stats.length === 0) return { teamA: [] as SummaryPlayer[], teamB: [] as SummaryPlayer[] };

  const userIds = stats.map((s) => s.userId).filter(Boolean) as string[];
  const memberships = userIds.length
    ? await db.query.teamMembers.findMany({
        where: (t, { inArray: inArr, and, eq: eqFn, or: orFn }) =>
          and(
            inArr(t.userId, userIds),
            orFn(eqFn(t.teamId, teamAId), eqFn(t.teamId, teamBId)),
          ),
        columns: { userId: true, teamId: true },
      })
    : [];

  const userIdToTeam = new Map(memberships.map((m) => [m.userId, m.teamId]));

  const teamARows = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === teamAId);
  const teamBRows = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === teamBId);
  const unmatched = stats.filter((s) => !s.userId || !userIdToTeam.has(s.userId));
  const half = Math.ceil(unmatched.length / 2);

  return {
    teamA: [...teamARows, ...unmatched.slice(0, half)].map((s) =>
      toSummaryPlayer(s, teamAId),
    ),
    teamB: [...teamBRows, ...unmatched.slice(half)].map((s) =>
      toSummaryPlayer(s, teamBId),
    ),
  };
}

type StatRow = typeof matchPlayerStats.$inferSelect;

function toSummaryPlayer(s: StatRow, teamId: string): SummaryPlayer {
  return {
    userId: s.userId,
    perfectName: s.perfectName,
    teamId,
    kills: s.kills ?? 0,
    deaths: s.deaths ?? 0,
    assists: s.assists ?? 0,
    hsPercent: s.hsPercent,
    firstKills: s.firstKills ?? 0,
    multiKills: s.multiKills ?? 0,
    clutches: s.clutches ?? 0,
    adr: s.adr,
    rws: s.rws,
    ratingPro: s.ratingPro,
    we: s.we,
    mapsPlayed: 1,
  };
}

export async function PlayerStatsTable({
  mapId,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
  seasonId,
  seasonSlug,
}: PlayerStatsTableProps) {
  const { teamA, teamB } = await getStatsGroupedByTeam(mapId, teamAId, teamBId, seasonId);

  if (teamA.length === 0 && teamB.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无玩家数据</p>;
  }

  return (
    <MatchSummaryStats
      players={[...teamA, ...teamB]}
      teamAId={teamAId}
      teamBId={teamBId}
      teamAName={teamAName}
      teamBName={teamBName}
      seasonSlug={seasonSlug}
      noPanel
    />
  );
}
