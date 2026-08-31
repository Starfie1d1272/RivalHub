import React from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { eventRosterMembers, eventRosters } from "@/db/schema";
import { MatchSummaryStats, type SummaryPlayer } from "./MatchSummaryStats";

interface PlayerStatsTableProps {
  mapId: string;
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
}

async function getStatsGroupedByTeam(
  mapId: string,
  entryAId: string,
  entryBId: string,
) {
  const stats = await db.query.matchPlayerStats.findMany({
    where: eq(matchPlayerStats.mapId, mapId),
    orderBy: (t, { desc }) => [desc(t.ratingPro)],
  });

  if (stats.length === 0) return { teamA: [] as SummaryPlayer[], teamB: [] as SummaryPlayer[] };

  const userIds = stats.map((s) => s.userId).filter(Boolean) as string[];
  const memberships = userIds.length
    ? await db
        .select({ userId: eventRosterMembers.userId, entryId: eventRosters.entryId })
        .from(eventRosterMembers)
        .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
        .where(and(
          inArray(eventRosterMembers.userId, userIds),
          inArray(eventRosters.entryId, [entryAId, entryBId]),
        ))
    : [];

  const userIdToTeam = new Map(memberships.map((m) => [m.userId, m.entryId]));

  const teamARows = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === entryAId);
  const teamBRows = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === entryBId);
  const unmatched = stats.filter((s) => !s.userId || !userIdToTeam.has(s.userId));
  const half = Math.ceil(unmatched.length / 2);

  return {
    teamA: [...teamARows, ...unmatched.slice(0, half)].map((s) =>
      toSummaryPlayer(s, entryAId),
    ),
    teamB: [...teamBRows, ...unmatched.slice(half)].map((s) =>
      toSummaryPlayer(s, entryBId),
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
  entryAId,
  entryBId,
  teamAName,
  teamBName,
}: PlayerStatsTableProps) {
  const { teamA, teamB } = await getStatsGroupedByTeam(mapId, entryAId, entryBId);

  if (teamA.length === 0 && teamB.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无玩家数据</p>;
  }

  return (
    <MatchSummaryStats
      players={[...teamA, ...teamB]}
      entryAId={entryAId}
      entryBId={entryBId}
      teamAName={teamAName}
      teamBName={teamBName}
      noPanel
    />
  );
}
