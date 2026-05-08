import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams } from "@/db/schema";
import { serializeBracket } from "@/lib/bracket";
import { BracketView } from "@/components/matches/BracketView";
import { MatchCard } from "@/components/matches/MatchCard";
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

  // 构建 teamId → name 映射（用于 MatchCard）
  const teamMap = new Map(allTeams.map((t) => [t.id, t.name]));

  const bracketData = serializeBracket(
    (season.bracketData as Database | null) ?? null,
    allTeams
  );

  const qualifierMatches = allMatches.filter((m) => m.stage === "qualifier");
  const playoffMatches = allMatches.filter((m) => m.stage === "playoff");

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-12">
      <h1 className="text-3xl font-bold text-[var(--text-primary)]">赛程总览</h1>

      {/* Bracket 视图 */}
      {bracketData.stage.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">对阵图</h2>
          <BracketView data={bracketData} themeColor={season.themeColor} />
        </section>
      )}

      {/* 排位赛列表 */}
      {qualifierMatches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">排位赛</h2>
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

      {/* 正赛列表 */}
      {playoffMatches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">正赛</h2>
          <div className="space-y-2">
            {playoffMatches.map((m) => (
              <MatchCard
                key={m.id}
                matchId={m.id}
                seasonSlug={seasonSlug}
                teamAName={teamMap.get(m.teamAId) ?? "未知队伍"}
                teamBName={teamMap.get(m.teamBId) ?? "未知队伍"}
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

      {allMatches.length === 0 && (
        <div className="text-center py-16 text-[var(--text-secondary)]">
          赛程尚未生成，敬请期待
        </div>
      )}
    </div>
  );
}
