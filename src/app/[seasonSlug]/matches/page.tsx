import { notFound } from "next/navigation";
import { eq, and, asc, count } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams } from "@/db/schema";
import { serializeBracket } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BracketView } from "@/components/matches/BracketView";
import { MatchCard } from "@/components/matches/MatchCard";
import { StandingsTable } from "@/components/matches/StandingsTable";
import type { Database } from "brackets-manager";

export const dynamic = "force-dynamic";

interface MatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function MatchesPage({ params }: MatchesPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const [allTeams, allMatches] = await Promise.all([
    db.query.teams.findMany({
      where: eq(teams.seasonId, season.id),
      orderBy: [asc(teams.draftOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
  ]);

  const teamMap = new Map(allTeams.map((t) => [t.id, t.name]));

  const qualifierMatches = allMatches.filter((m) => m.stage === "qualifier");
  const playoffMatches = allMatches.filter((m) => m.stage === "playoff");

  // 积分榜（仅当有排位赛时计算）
  const standings = season.qualifierFormat
    ? await calculateStandings(season.id, allTeams)
    : [];

  const allQualifierFinished =
    qualifierMatches.length > 0 &&
    qualifierMatches.every((m) => m.status === "finished" || m.status === "cancelled");

  // Bracket 数据（用于正赛 bracket 视图）
  const bracketData = serializeBracket(
    (season.bracketData as Database | null) ?? null,
    allTeams
  );

  // 正赛 stage 的 bracket 数据（筛出正赛 stage）
  const playoffBracketData = {
    ...bracketData,
    stage: bracketData.stage.filter((s) => s.name === "正赛"),
    match: bracketData.match.filter((m) =>
      bracketData.stage.some((s) => s.name === "正赛" && s.id === m.stageId)
    ),
  };

  // bracketNodeId（字符串）→ matchId（UUID），用于 BracketView 点击跳转
  const matchNodeMap = new Map<string, string>(
    playoffMatches
      .filter((m) => m.bracketNodeId !== null)
      .map((m) => [m.bracketNodeId!, m.id])
  );

  const hasQualifier = !!season.qualifierFormat;
  const hasPlayoff = !!season.playoffFormat;

  if (allMatches.length === 0 && allTeams.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-[var(--text-secondary)]">
        赛程尚未生成，敬请期待
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-8">
      <h1 className="text-3xl font-bold text-[var(--text-primary)]">赛程总览</h1>

      <Tabs defaultValue={hasQualifier ? "qualifier" : "playoff"} className="w-full">
        <TabsList className="mb-6">
          {hasQualifier && <TabsTrigger value="qualifier">排位赛</TabsTrigger>}
          {hasPlayoff && <TabsTrigger value="playoff">正赛</TabsTrigger>}
        </TabsList>

        {/* ── 排位赛面板 ─────────────────────────────────────────── */}
        {hasQualifier && (
          <TabsContent value="qualifier" className="space-y-8">
            {/* 积分榜 */}
            {standings.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">积分榜</h2>
                  {allQualifierFinished && (
                    <span className="text-xs text-green-600 font-medium">最终排名</span>
                  )}
                </div>
                <StandingsTable
                  standings={standings}
                  seasonSlug={seasonSlug}
                  isFinal={allQualifierFinished}
                />
              </section>
            )}

            {/* 赛程列表 */}
            {qualifierMatches.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">赛程</h2>
                <div className="space-y-2">
                  {qualifierMatches.map((m) => (
                    <MatchCard
                      key={m.id}
                      matchId={m.id}
                      seasonSlug={seasonSlug}
                      teamAName={teamMap.get(m.teamAId) ?? "未知队伍"}
                      teamBName={teamMap.get(m.teamBId) ?? "未知队伍"}
                      scoreA={m.scoreA}
                      scoreB={m.scoreB}
                      stage="qualifier"
                      format={m.format as "bo1" | "bo3" | "bo5"}
                      status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                    />
                  ))}
                </div>
              </section>
            )}

            {qualifierMatches.length === 0 && (
              <div className="text-center py-16 text-[var(--text-secondary)]">
                排位赛赛程尚未生成
              </div>
            )}
          </TabsContent>
        )}

        {/* ── 正赛面板 ───────────────────────────────────────────── */}
        {hasPlayoff && (
          <TabsContent value="playoff" className="space-y-8">
            {/* Bracket 图 */}
            {playoffBracketData.stage.length > 0 && (
              <section id="bracket" className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">对阵图</h2>
                <BracketView
                  data={playoffBracketData}
                  themeColor={season.themeColor}
                  matchNodeMap={matchNodeMap}
                  seasonSlug={seasonSlug}
                />
              </section>
            )}

            {/* 正赛赛程列表 */}
            {playoffMatches.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">赛程</h2>
                <div className="space-y-2">
                  {playoffMatches.map((m) => (
                    <MatchCard
                      key={m.id}
                      matchId={m.id}
                      seasonSlug={seasonSlug}
                      teamAName={teamMap.get(m.teamAId) ?? "TBD"}
                      teamBName={teamMap.get(m.teamBId) ?? "TBD"}
                      scoreA={m.scoreA}
                      scoreB={m.scoreB}
                      stage="playoff"
                      format={m.format as "bo1" | "bo3" | "bo5"}
                      status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                    />
                  ))}
                </div>
              </section>
            )}

            {playoffMatches.length === 0 && (
              <div className="text-center py-16 text-[var(--text-secondary)]">
                {allQualifierFinished
                  ? "正赛即将开始，敬请期待"
                  : "正赛将在排位赛结束后生成"}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
