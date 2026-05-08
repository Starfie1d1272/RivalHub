import { notFound } from "next/navigation";
import { eq, count, asc, and } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { calculateStandings } from "@/lib/standings";
import { GenerateScheduleCard } from "@/components/matches/GenerateScheduleCard";
import { GeneratePlayoffCard } from "@/components/matches/GeneratePlayoffCard";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { ScoreInput } from "@/components/matches/ScoreInput";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
}

const FORMAT_LABELS = { bo1: "BO1", bo3: "BO3", bo5: "BO5" };

export default async function AdminMatchesPage({ params }: AdminMatchesPageProps) {
  await requireAdmin();
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

  const matchCount = allMatches.length;
  const qualifierCount = qualifierMatches.length;
  const playoffCount = playoffMatches.length;

  const canGenerate = season.status === "playing" && matchCount === 0 && allTeams.length >= 2;

  // 是否所有排位赛已结束
  const allQualifierFinished =
    qualifierCount > 0 &&
    qualifierMatches.every((m) => m.status === "finished" || m.status === "cancelled");

  // 是否可以生成正赛
  const canGeneratePlayoff =
    !!season.qualifierFormat &&
    !!season.playoffFormat &&
    allQualifierFinished &&
    playoffCount === 0;

  // 积分榜（有排位赛时计算）
  const standings =
    season.qualifierFormat && qualifierCount > 0
      ? await calculateStandings(season.id, allTeams)
      : [];

  const hasQualifier = !!season.qualifierFormat;
  const hasPlayoff = !!season.playoffFormat;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          比赛管理 · {season.name}
        </h1>
        <Link
          href={`/${seasonSlug}/matches`}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          查看公开赛程 →
        </Link>
      </div>

      {/* 赛季状态提示 */}
      {season.status !== "playing" && matchCount === 0 && (
        <Card className="p-4 border-yellow-500/30 bg-yellow-500/5">
          <p className="text-sm text-yellow-600">
            赛季当前状态为「{season.status}」，需进入 playing 状态后才能生成赛程。
          </p>
        </Card>
      )}

      {/* 一键生成赛程（首次） */}
      {canGenerate && (
        <GenerateScheduleCard
          seasonId={season.id}
          qualifierFormat={season.qualifierFormat ?? null}
          playoffFormat={season.playoffFormat ?? null}
          teamCount={allTeams.length}
        />
      )}

      {/* 生成正赛（排位赛全部结束后） */}
      {canGeneratePlayoff && standings.length > 0 && (
        <GeneratePlayoffCard seasonId={season.id} standings={standings} />
      )}

      {/* Tab 面板 */}
      {matchCount > 0 && (
        <Tabs defaultValue={hasQualifier ? "qualifier" : "playoff"}>
          <TabsList>
            {hasQualifier && <TabsTrigger value="qualifier">排位赛</TabsTrigger>}
            {hasPlayoff && <TabsTrigger value="playoff">正赛</TabsTrigger>}
          </TabsList>

          {/* 排位赛面板 */}
          {hasQualifier && (
            <TabsContent value="qualifier" className="space-y-6 mt-4">
              {/* 积分榜 */}
              {standings.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">积分榜</h2>
                  <Card className="p-0 overflow-hidden">
                    <StandingsTable
                      standings={standings}
                      seasonSlug={seasonSlug}
                      isFinal={allQualifierFinished}
                    />
                  </Card>
                </section>
              )}

              {/* 排位赛列表 */}
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">赛程</h2>
                <div className="space-y-3">
                  {qualifierMatches.map((m) => {
                    const teamAName = teamMap.get(m.teamAId) ?? "未知队伍";
                    const teamBName = teamMap.get(m.teamBId) ?? "未知队伍";
                    return (
                      <Card key={m.id} className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">{teamAName}</span>
                            <span className="text-[var(--text-secondary)]">
                              {m.status === "finished"
                                ? `${m.scoreA ?? 0} : ${m.scoreB ?? 0}`
                                : "vs"}
                            </span>
                            <span className="font-semibold">{teamBName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
                              {FORMAT_LABELS[m.format as keyof typeof FORMAT_LABELS]}
                            </Badge>
                            <MatchStatusBadge
                              status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                            />
                          </div>
                        </div>
                        {m.status !== "finished" && m.status !== "cancelled" && (
                          <>
                            <Separator />
                            <ScoreInput
                              matchId={m.id}
                              teamAName={teamAName}
                              teamBName={teamBName}
                              currentStatus={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                              isBO1
                            />
                          </>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </section>
            </TabsContent>
          )}

          {/* 正赛面板 */}
          {hasPlayoff && (
            <TabsContent value="playoff" className="space-y-3 mt-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">赛程</h2>
              {playoffMatches.length === 0 ? (
                <Card className="p-8 text-center text-[var(--text-secondary)]">
                  {allQualifierFinished ? "点击上方「生成正赛」按钮" : "排位赛全部结束后可生成正赛"}
                </Card>
              ) : (
                <div className="space-y-3">
                  {playoffMatches.map((m) => {
                    const teamAName = teamMap.get(m.teamAId) ?? "TBD";
                    const teamBName = teamMap.get(m.teamBId) ?? "TBD";
                    return (
                      <Card key={m.id} className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">{teamAName}</span>
                            <span className="text-[var(--text-secondary)]">
                              {m.status === "finished"
                                ? `${m.scoreA ?? 0} : ${m.scoreB ?? 0}`
                                : "vs"}
                            </span>
                            <span className="font-semibold">{teamBName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
                              {FORMAT_LABELS[m.format as keyof typeof FORMAT_LABELS]}
                            </Badge>
                            <MatchStatusBadge
                              status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                            />
                          </div>
                        </div>
                        {m.status !== "finished" && m.status !== "cancelled" && (
                          <>
                            <Separator />
                            <ScoreInput
                              matchId={m.id}
                              teamAName={teamAName}
                              teamBName={teamBName}
                              currentStatus={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                              isBO1={false}
                            />
                          </>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}

      {!canGenerate && matchCount === 0 && (
        <Card className="p-8 text-center text-[var(--text-secondary)]">暂无比赛记录</Card>
      )}
    </div>
  );
}
