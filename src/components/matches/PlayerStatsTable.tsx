import React from "react";
import { eq, and, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { teamMembers } from "@/db/schema/teams";
import { seasonRegistrations } from "@/db/schema/registrations";
import { matches } from "@/db/schema/matches";

interface PlayerStatsTableProps {
  matchId: string;
  mapId: string;
}

async function getStatsGroupedByTeam(mapId: string, matchId: string) {
  const stats = await db.query.matchPlayerStats.findMany({
    where: eq(matchPlayerStats.mapId, mapId),
    orderBy: (t, { desc }) => [desc(t.ratingPro)],
  });

  if (stats.length === 0) return { teamA: [], teamB: [] };

  const matchData = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
    columns: { teamAId: true, teamBId: true, seasonId: true },
  });
  if (!matchData) return { teamA: stats.slice(0, 5), teamB: stats.slice(5) };

  const userIds = stats.map((s) => s.userId).filter(Boolean) as string[];
  const registrations = userIds.length
    ? await db.query.seasonRegistrations.findMany({
        where: (t, { inArray: inArr, and, eq: eqFn }) =>
          and(inArr(t.userId, userIds), eqFn(t.seasonId, matchData.seasonId)),
        columns: { id: true, userId: true },
      })
    : [];
  const regIds = registrations.map((r) => r.id);
  const memberships = regIds.length
    ? await db.query.teamMembers.findMany({
        where: (t, { inArray: inArr, and, eq: eqFn, or: orFn }) =>
          and(
            inArr(t.registrationId, regIds),
            orFn(eqFn(t.teamId, matchData.teamAId), eqFn(t.teamId, matchData.teamBId)),
          ),
        columns: { registrationId: true, teamId: true },
      })
    : [];

  const userIdToTeam = new Map<string, string>();
  for (const reg of registrations) {
    const mship = memberships.find((m) => m.registrationId === reg.id);
    if (mship) userIdToTeam.set(reg.userId, mship.teamId);
  }

  const teamA = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === matchData.teamAId);
  const teamB = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === matchData.teamBId);

  const unmatched = stats.filter((s) => !s.userId || !userIdToTeam.has(s.userId));
  const half = Math.ceil(unmatched.length / 2);

  return {
    teamA: [...teamA, ...unmatched.slice(0, half)],
    teamB: [...teamB, ...unmatched.slice(half)],
  };
}

type StatRow = Awaited<ReturnType<typeof getStatsGroupedByTeam>>["teamA"][number];

export async function PlayerStatsTable({ matchId, mapId }: PlayerStatsTableProps) {
  const { teamA, teamB } = await getStatsGroupedByTeam(mapId, matchId);

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)] py-2">
        暂无玩家数据
      </p>
    );
  }

  const cols = ["选手", "K", "D", "A", "ADR", "Rating"];

  return (
    <div className="grid grid-cols-2 gap-3 mt-2">
      <StatTeamBlock label="Team A" players={teamA} cols={cols} />
      <StatTeamBlock label="Team B" players={teamB} cols={cols} />
    </div>
  );
}

function StatTeamBlock({
  label,
  players,
  cols,
}: {
  label: string;
  players: StatRow[];
  cols: string[];
}) {
  return (
    <div className="rounded-md bg-[var(--bg-overlay)] p-3">
      <p className="text-[11px] text-[var(--text-secondary)] mb-2 font-medium">
        {label}
      </p>
      <div
        className="grid gap-x-2 gap-y-1 text-xs"
        style={{ gridTemplateColumns: `1.5fr repeat(${cols.length - 1}, 1fr)` }}
      >
        {cols.map((c) => (
          <span key={c} className="text-[var(--text-muted)] text-[10px]">
            {c}
          </span>
        ))}
        {players.map((p) => (
          <PlayerStatRow key={p.id} stat={p} />
        ))}
      </div>
    </div>
  );
}

function PlayerStatRow({ stat }: { stat: StatRow }) {
  return (
    <>
      <span className="text-[var(--text-primary)] truncate">
        {stat.perfectName}
      </span>
      <span className="tabular-nums text-[var(--text-primary)]">
        {stat.kills ?? "—"}
      </span>
      <span className="tabular-nums text-[var(--text-primary)]">
        {stat.deaths ?? "—"}
      </span>
      <span className="tabular-nums text-[var(--text-primary)]">
        {stat.assists ?? "—"}
      </span>
      <span className="tabular-nums text-[var(--text-secondary)]">
        {stat.adr != null ? stat.adr.toFixed(1) : "—"}
      </span>
      <span
        className="tabular-nums font-semibold"
        style={{
          color:
            stat.ratingPro != null && stat.ratingPro >= 1.2
              ? "var(--season-primary)"
              : "var(--text-primary)",
        }}
      >
        {stat.ratingPro != null ? stat.ratingPro.toFixed(2) : "—"}
      </span>
    </>
  );
}
