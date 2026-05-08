import { notFound } from "next/navigation";
import { eq, count, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { GenerateScheduleCard } from "@/components/matches/GenerateScheduleCard";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { ScoreInput } from "@/components/matches/ScoreInput";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
}

const STAGE_LABELS = { qualifier: "排位赛", playoff: "正赛" };
const FORMAT_LABELS = { bo1: "BO1", bo3: "BO3", bo5: "BO5" };

export default async function AdminMatchesPage({ params }: AdminMatchesPageProps) {
  await requireAdmin();
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const [allTeams, allMatches, [{ value: matchCount }]] = await Promise.all([
    db.query.teams.findMany({
      where: eq(teams.seasonId, season.id),
      orderBy: [asc(teams.draftOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
    db.select({ value: count() }).from(matches).where(eq(matches.seasonId, season.id)),
  ]);

  const teamMap = new Map(allTeams.map((t) => [t.id, t.name]));

  const qualifierMatches = allMatches.filter((m) => m.stage === "qualifier");
  const playoffMatches = allMatches.filter((m) => m.stage === "playoff");

  const canGenerate = season.status === "playing" && matchCount === 0 && allTeams.length >= 2;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
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

      {/* 一键生成卡片 */}
      {canGenerate && (
        <GenerateScheduleCard
          seasonId={season.id}
          qualifierFormat={season.qualifierFormat ?? null}
          playoffFormat={season.playoffFormat ?? null}
          teamCount={allTeams.length}
        />
      )}

      {/* 排位赛列表 */}
      {qualifierMatches.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">排位赛</h2>
          <div className="space-y-3">
            {qualifierMatches.map((m) => {
              const teamAName = teamMap.get(m.teamAId) ?? "未知队伍";
              const teamBName = teamMap.get(m.teamBId) ?? "未知队伍";
              return (
                <Card key={m.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[var(--text-primary)]">{teamAName}</span>
                      <span className="text-[var(--text-secondary)]">
                        {m.status === "finished"
                          ? `${m.scoreA ?? 0} : ${m.scoreB ?? 0}`
                          : "vs"}
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">{teamBName}</span>
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
                        currentStatus={
                          m.status as "scheduled" | "in_progress" | "finished" | "cancelled"
                        }
                      />
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* 正赛列表 */}
      {playoffMatches.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">正赛</h2>
          <div className="space-y-3">
            {playoffMatches.map((m) => {
              const teamAName = teamMap.get(m.teamAId) ?? "未知队伍";
              const teamBName = teamMap.get(m.teamBId) ?? "未知队伍";
              return (
                <Card key={m.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[var(--text-primary)]">{teamAName}</span>
                      <span className="text-[var(--text-secondary)]">
                        {m.status === "finished"
                          ? `${m.scoreA ?? 0} : ${m.scoreB ?? 0}`
                          : "vs"}
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">{teamBName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
                        {STAGE_LABELS.playoff}
                      </Badge>
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
                        currentStatus={
                          m.status as "scheduled" | "in_progress" | "finished" | "cancelled"
                        }
                      />
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {!canGenerate && allMatches.length === 0 && (
        <Card className="p-8 text-center text-[var(--text-secondary)]">
          暂无比赛记录
        </Card>
      )}
    </div>
  );
}
