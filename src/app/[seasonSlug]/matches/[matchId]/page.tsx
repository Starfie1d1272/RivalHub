import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema/seasons";
import { matches } from "@/db/schema/matches";
import { matchMaps } from "@/db/schema/match-maps";
import { teams } from "@/db/schema/teams";
import { MatchDetail, type MatchDetailData, type MatchMapData } from "@/components/matches/MatchDetail";

export const dynamic = "force-dynamic";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

export async function generateMetadata({ params }: MatchDetailPageProps) {
  const { matchId } = await params;
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) return { title: "比赛详情" };
  const [teamA, teamB] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
    db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
  ]);
  return { title: `${teamA?.name ?? "?"} vs ${teamB?.name ?? "?"} · 比赛详情` };
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });
  if (!match || match.seasonId !== season.id) notFound();

  const [teamA, teamB, mapRows] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
    db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
    db
      .select()
      .from(matchMaps)
      .where(eq(matchMaps.matchId, matchId))
      .orderBy(matchMaps.mapOrder),
  ]);

  if (!teamA || !teamB) notFound();

  // 构建 pickedByTeamName
  const teamNameMap = new Map([
    [teamA.id, teamA.name],
    [teamB.id, teamB.name],
  ]);

  const mapData: MatchMapData[] = mapRows.map((m) => ({
    mapOrder: m.mapOrder,
    mapName: m.mapName,
    pickedByTeamName: m.pickedByTeamId ? (teamNameMap.get(m.pickedByTeamId) ?? null) : null,
    teamAStartSide: m.teamAStartSide,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
  }));

  const matchData: MatchDetailData = {
    id: match.id,
    teamAName: teamA.name,
    teamAId: teamA.id,
    teamBName: teamB.name,
    teamBId: teamB.id,
    format: match.format,
    stage: match.stage,
    status: match.status,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    scheduledAt: match.scheduledAt,
    completedAt: match.completedAt,
    maps: mapData,
    seasonSlug,
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <MatchDetail match={matchData} />
    </div>
  );
}
