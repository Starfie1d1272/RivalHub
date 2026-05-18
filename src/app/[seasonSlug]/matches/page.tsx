import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams } from "@/db/schema";
import { serializeBracket } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { Panel, Marker } from "@/components/rivalhub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BracketView } from "@/components/matches/BracketView";
import { MatchTeamFilter } from "@/components/matches/MatchTeamFilter";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { SwissBracket } from "@/components/matches/SwissBracket";
import { getSwissViewData } from "@/lib/swiss/data";
import { getFirstStageOfType, normalizeStagePlan } from "@/types/season";
import { MatchTabsSection } from "@/components/matches/MatchTabsSection";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminShortcut } from "@/components/layout/AdminShortcut";
import type { Database } from "brackets-manager";

export const dynamic = "force-dynamic";

interface MatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ team?: string }>;
}

export default async function MatchesPage({ params, searchParams }: MatchesPageProps) {
  const { seasonSlug } = await params;
  const { team: filterTeamId } = await searchParams;

  const [seasonResult, adminSession] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    checkAdminSession(),
  ]);
  const season = seasonResult;
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
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const qualifierStage = getFirstStageOfType(stagePlan, ["round_robin", "swiss"]);
  const playoffStage = getFirstStageOfType(stagePlan, ["double_elim", "single_elim"]);
  const qualifierKey = qualifierStage?.key ?? "qualifier";
  const playoffKey = playoffStage?.key ?? "playoff";

  const qualifierMatchesAll = allMatches.filter((m) => m.stage === qualifierKey);
  const playoffMatchesAll = allMatches.filter((m) => m.stage === playoffKey);

  // 按队伍筛选
  const matchFilter = (m: { teamAId: string; teamBId: string }) =>
    !filterTeamId || m.teamAId === filterTeamId || m.teamBId === filterTeamId;
  const qualifierMatches = qualifierMatchesAll.filter(matchFilter);
  const playoffMatches = playoffMatchesAll.filter(matchFilter);

  // 排序：已排期（由近及远）→ 未排期
  const sortMatchList = (list: typeof allMatches) =>
    [...list].sort((a, b) => {
      const aTime = a.scheduledAt?.getTime() ?? Infinity;
      const bTime = b.scheduledAt?.getTime() ?? Infinity;
      if (aTime !== bTime) return aTime - bTime;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  const splitMatches = (list: typeof allMatches) => ({
    active: sortMatchList(list.filter((m) => m.status !== "finished" && m.status !== "cancelled")),
    done: sortMatchList(list.filter((m) => m.status === "finished" || m.status === "cancelled")),
  });

  const { active: qualifierActive, done: qualifierDone } = splitMatches(qualifierMatches);
  const { active: playoffActive, done: playoffDone } = splitMatches(playoffMatches);

  // 积分榜（仅当有 round_robin 排位赛时计算，使用未筛选的全部排位赛）
  const finishedQualifierMatches = qualifierMatchesAll.filter((m) => m.status === "finished");
  const standings = qualifierStage && qualifierStage.type !== "swiss"
    ? calculateStandings(allTeams, finishedQualifierMatches)
    : [];

  // 瑞士轮视图数据（仅当有 swiss 排位赛时查询）
  const swissData = qualifierStage?.type === "swiss"
    ? await getSwissViewData(season.id, qualifierKey, qualifierStage.name)
    : null;

  const allQualifierFinished =
    qualifierMatchesAll.length > 0 &&
    qualifierMatchesAll.every((m) => m.status === "finished" || m.status === "cancelled");

  // Bracket 数据（用于正赛 bracket 视图）
  const fullBracketData = serializeBracket(
    (season.bracketData as Database | null) ?? null,
    allTeams
  );

  // 正赛 stage 的 bracket 数据；brackets-viewer 需要 stage 和 match 同步过滤。
  const playoffBracketStageIds = new Set(
    fullBracketData.stage
      .filter((s) => s.name === playoffStage?.name)
      .map((s) => s.id),
  );
  const playoffBracketMatchIds = new Set(
    fullBracketData.match
      .filter((m) => playoffBracketStageIds.has(m.stage_id))
      .map((m) => m.id),
  );
  const bracketData = {
    ...fullBracketData,
    stage: fullBracketData.stage.filter((s) => playoffBracketStageIds.has(s.id)),
    match: fullBracketData.match.filter((m) => playoffBracketStageIds.has(m.stage_id)),
    match_game: fullBracketData.match_game.filter((game) => {
      const parentId = game.parent_id;
      return typeof parentId === "number" && playoffBracketMatchIds.has(parentId);
    }),
  };

  // bracketNodeId（字符串）→ matchId（UUID），用于 BracketView 点击跳转
  const matchNodeMap = new Map<string, string>(
    playoffMatches
      .filter((m) => m.bracketNodeId !== null)
      .map((m) => [m.bracketNodeId!, m.id])
  );

  const hasQualifier = !!qualifierStage;
  const hasPlayoff = !!playoffStage;

  if (allMatches.length === 0 && allTeams.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-[var(--color-fg-mid)]">
        赛程尚未生成，敬请期待
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-8">
      <div className="flex items-center justify-between">
        <Marker sub={season.name}>赛程总览</Marker>
        {adminSession && (
          <AdminShortcut href={`/admin/${seasonSlug}/matches`} />
        )}
      </div>

      {allTeams.length > 0 && (
        <MatchTeamFilter teams={allTeams.map((t) => ({ id: t.id, name: t.name }))} />
      )}

      <Panel pad={24}>
      <Tabs defaultValue={hasQualifier ? qualifierKey : playoffKey} className="w-full">
        <TabsList className="mb-6 bg-[var(--color-panel)] border border-[var(--color-border)] p-1">
          {qualifierStage && <TabsTrigger value={qualifierKey} className="data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-accent-fg)]">{qualifierStage.name}</TabsTrigger>}
          {playoffStage && <TabsTrigger value={playoffKey} className="data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-accent-fg)]">{playoffStage.name}</TabsTrigger>}
        </TabsList>

        {/* ── 排位赛面板 ─────────────────────────────────────────── */}
        {hasQualifier && (
          <TabsContent value={qualifierKey} className="space-y-8">
            {/* Swiss 视图 */}
            {swissData ? (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--color-fg)]">
                  {qualifierStage?.name ?? "瑞士轮"}
                </h2>
                <SwissBracket data={swissData} seasonSlug={seasonSlug} />
              </section>
            ) : (
              <>
                {/* 积分榜 */}
                {standings.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-[var(--color-fg)]">积分榜</h2>
                      {allQualifierFinished && (
                        <span className="text-xs text-[var(--color-ok)] font-medium">最终排名</span>
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
                {qualifierMatchesAll.length > 0 && (
                  <section className="space-y-3">
                    <MatchTabsSection
                      activeMatches={qualifierActive}
                      doneMatches={qualifierDone}
                      stage={qualifierKey}
                      seasonSlug={seasonSlug}
                      teamMap={teamMap}
                    />
                  </section>
                )}

                {qualifierMatchesAll.length === 0 && (
                  <div className="text-center py-16 text-[var(--color-fg-mid)]">
                    排位赛赛程尚未生成
                  </div>
                )}
              </>
            )}
          </TabsContent>
        )}

        {/* ── 正赛面板 ───────────────────────────────────────────── */}
        {hasPlayoff && (
          <TabsContent value={playoffKey} className="space-y-8">
            {/* Bracket 图 */}
            {bracketData.stage.length > 0 && (
              <section id="bracket" className="space-y-3">
                <h2 className="text-lg font-semibold text-[var(--color-fg)]">对阵图</h2>
                <BracketView
                  data={bracketData}
                  themeColor={season.themeColor}
                  matchNodeMap={matchNodeMap}
                  seasonSlug={seasonSlug}
                />
              </section>
            )}

            {/* 正赛赛程列表 */}
            {playoffMatchesAll.length > 0 && (
              <section className="space-y-3">
                <MatchTabsSection
                  activeMatches={playoffActive}
                  doneMatches={playoffDone}
                  stage={playoffKey}
                  seasonSlug={seasonSlug}
                  teamMap={teamMap}
                  unknownTeamName="TBD"
                />
              </section>
            )}

            {playoffMatchesAll.length === 0 && (
              <div className="text-center py-16 text-[var(--color-fg-mid)]">
                {allQualifierFinished
                  ? "正赛即将开始，敬请期待"
                  : "正赛将在排位赛结束后生成"}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
      </Panel>
    </div>
  );
}
