import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps } from "@/db/schema";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

const FORMAT_LABELS = { bo1: "BO1", bo3: "BO3", bo5: "BO5" };
const STAGE_LABELS = { qualifier: "排位赛", playoff: "正赛" };
const SIDE_LABELS = { t: "T 方", ct: "CT 方" };

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

  const [teamA, teamB, maps] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
    db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
    db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, matchId),
      orderBy: (t, { asc }) => [asc(t.mapOrder)],
    }),
  ]);

  const isFinished = match.status === "finished";

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-8">
      {/* 导航 */}
      <div className="flex items-center gap-4">
        <Link
          href={`/${seasonSlug}/matches`}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          ← 返回赛程总览
        </Link>
        {match.stage === "playoff" && match.bracketNodeId && (
          <Link
            href={`/${seasonSlug}/matches#bracket`}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            查看对阵图 →
          </Link>
        )}
      </div>

      {/* 头部：比赛信息 */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[var(--text-secondary)]">
            {STAGE_LABELS[match.stage as keyof typeof STAGE_LABELS]}
          </Badge>
          <Badge variant="outline" className="text-[var(--text-secondary)]">
            {FORMAT_LABELS[match.format as keyof typeof FORMAT_LABELS]}
          </Badge>
          <MatchStatusBadge status={match.status as "scheduled" | "in_progress" | "finished" | "cancelled"} />
        </div>

        <div className="flex items-center justify-center gap-6 py-4">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {teamA?.name ?? "未知队伍"}
          </span>
          <div className="text-center">
            {isFinished ? (
              <span className="text-4xl font-mono font-bold text-[var(--primary)]">
                {match.scoreA ?? 0}&nbsp;:&nbsp;{match.scoreB ?? 0}
              </span>
            ) : (
              <span className="text-3xl font-bold text-[var(--text-secondary)]">vs</span>
            )}
          </div>
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {teamB?.name ?? "未知队伍"}
          </span>
        </div>
      </Card>

      {/* 单图结果 */}
      {maps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">地图结果</h2>
          <div className="space-y-2">
            {maps.map((map) => (
              <Card key={map.id} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-secondary)] w-5">
                      #{map.mapOrder}
                    </span>
                    <span className="font-medium text-[var(--text-primary)]">{map.mapName}</span>
                    {map.pickedByTeamId === match.teamAId && (
                      <Badge variant="outline" className="text-xs">
                        {teamA?.name} Pick
                      </Badge>
                    )}
                    {map.pickedByTeamId === match.teamBId && (
                      <Badge variant="outline" className="text-xs">
                        {teamB?.name} Pick
                      </Badge>
                    )}
                    {map.pickedByTeamId === null && (
                      <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
                        决胜图
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {map.teamAStartSide && (
                      <span className="text-[var(--text-secondary)]">
                        {teamA?.name} {SIDE_LABELS[map.teamAStartSide]}先
                      </span>
                    )}
                    {map.scoreA !== null && map.scoreB !== null && (
                      <span className="font-mono font-bold text-[var(--text-primary)]">
                        {map.scoreA}&nbsp;:&nbsp;{map.scoreB}
                      </span>
                    )}
                  </div>
                </div>
                {isFinished && (
                  <PlayerStatsTable matchId={match.id} mapId={map.id} />
                )}
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
