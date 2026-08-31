import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { majorFinalResults, seasons, matches, competitionEntries } from "@/db/schema";
import { serializeBracket } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { Panel, Marker } from "@/components/rivalhub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BracketView } from "@/components/matches/BracketView";
import { MatchTeamFilter } from "@/components/matches/MatchTeamFilter";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { SwissBracket } from "@/components/matches/SwissBracket";
import { getSwissViewData } from "@/lib/swiss/data";
import {
  buildStageViews,
  canUseLegacySwissView,
  getTeamsReferencedByMatches,
  projectLegacyBracketByStageName,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { normalizeStagePlan } from "@/types/season";
import { MatchTabsSection } from "@/components/matches/MatchTabsSection";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminShortcut } from "@/components/layout/AdminShortcut";
import type { BracketDatabase as Database } from "@/lib/bracket";

interface MatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ team?: string }>;
}

export default async function MatchesPage({ params, searchParams }: MatchesPageProps) {
  const { seasonSlug } = await params;
  const { team: filterTeamId } = await searchParams;

  const [season, adminSession] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    checkAdminSession(),
  ]);
  if (!season) notFound();

  const [allTeams, allMatches, finalResult] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, season.id),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
  ]);

  const teamMap = new Map(allTeams.map((team) => [team.id, team.name]));
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const { views: stageViews, unconfiguredMatches } = buildStageViews(stagePlan, allMatches);
  const matchFilter = (match: { entryAId: string; entryBId: string }) =>
    !filterTeamId || match.entryAId === filterTeamId || match.entryBId === filterTeamId;

  const sortActiveMatches = (stageMatches: typeof allMatches) =>
    [...stageMatches].sort((a, b) => {
      const timeDifference = (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity);
      return timeDifference || a.createdAt.getTime() - b.createdAt.getTime();
    });
  const sortDoneMatches = (stageMatches: typeof allMatches) =>
    [...stageMatches].sort((a, b) => {
      const timeDifference = (b.completedAt ?? b.scheduledAt)?.getTime() ?? 0;
      const otherTime = (a.completedAt ?? a.scheduledAt)?.getTime() ?? 0;
      return timeDifference - otherTime || b.createdAt.getTime() - a.createdAt.getTime();
    });
  const splitMatches = (stageMatches: typeof allMatches) => ({
    active: sortActiveMatches(
      stageMatches.filter((match) => match.status !== "finished" && match.status !== "cancelled"),
    ),
    done: sortDoneMatches(
      stageMatches.filter((match) => match.status === "finished" || match.status === "cancelled"),
    ),
  });

  const swissDataByStage = new Map(
    await Promise.all(
      stageViews
        .filter(({ stage, matches: stageMatches }) => stage.type === "swiss" && stageMatches.length > 0)
        .map(async ({ stage }) => [
          stage.key,
          await getSwissViewData(season.id, stage.key, stage.name),
        ] as const),
    ),
  );
  const fullBracketData = serializeBracket((season.bracketData as Database | null) ?? null);
  const defaultStageKey = resolveDefaultStageKey(stagePlan, allMatches);

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
        {adminSession && <AdminShortcut href={`/admin/${seasonSlug}/matches`} />}
      </div>

      {allTeams.length > 0 && (
        <MatchTeamFilter teams={allTeams.map((team) => ({ id: team.id, name: team.name }))} />
      )}

      {unconfiguredMatches.length > 0 && (
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">
            部分赛程数据与当前阶段配置不一致。
          </p>
        </Panel>
      )}

      {finalResult?.status === "pending_confirmation" && (
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">淘汰赛已结束，冠军和正式名次正在等待赛事方确认；赛事不会静默归档。</p>
        </Panel>
      )}

      {defaultStageKey && (
        <Panel pad={24}>
          <Tabs defaultValue={defaultStageKey} className="w-full">
            <TabsList className="mb-6 max-w-full justify-start overflow-x-auto bg-[var(--color-panel)] border border-[var(--color-border)] p-1">
              {stageViews.map(({ stage }) => (
                <TabsTrigger
                  key={stage.key}
                  value={stage.key}
                  className="data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-accent-fg)]"
                >
                  {stage.name}
                </TabsTrigger>
              ))}
            </TabsList>

            {stageViews.map(({ stage, matches: allStageMatches }) => {
              const stageMatches = allStageMatches.filter(matchFilter);
              const { active, done } = splitMatches(stageMatches);
              const swissData = swissDataByStage.get(stage.key);
              const canShowSwissBracket = canUseLegacySwissView(stage, allStageMatches, swissData);
              const standings = stage.type === "round_robin" && allStageMatches.length > 0
                ? calculateStandings(
                    getTeamsReferencedByMatches(allTeams, allStageMatches),
                    allStageMatches.filter((match) => match.status === "finished"),
                  )
                : [];
              const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";
              const bracketProjection = isPlayoff
                ? projectLegacyBracketByStageName(fullBracketData, stage.name)
                : null;
              const matchNodeMap = new Map<string, string>(
                allStageMatches
                  .filter((match) => match.bracketNodeId !== null)
                  .map((match) => [match.bracketNodeId!, match.id]),
              );

              return (
                <TabsContent key={stage.key} value={stage.key} className="space-y-8">
                  {canShowSwissBracket ? (
                    <section className="space-y-3">
                      <h2 className="text-lg font-semibold text-[var(--color-fg)]">{stage.name}</h2>
                      <SwissBracket data={swissData} seasonSlug={seasonSlug} />
                    </section>
                  ) : (
                    <>
                      {stage.type === "swiss" && allStageMatches.length > 0 && (
                        <p className="text-sm text-[var(--color-warn)]">
                          瑞士轮统计投影暂不可用。
                        </p>
                      )}

                      {bracketProjection?.status === "ambiguous" && (
                        <p className="text-sm text-[var(--color-warn)]">
                          对阵图映射异常。
                        </p>
                      )}

                      {standings.length > 0 && (
                        <section className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-[var(--color-fg)]">积分榜</h2>
                          </div>
                          <StandingsTable
                            standings={standings}
                            seasonSlug={seasonSlug}
                            isFinal={false}
                          />
                        </section>
                      )}

                      {bracketProjection?.status === "ok" && (
                        <section className="space-y-3">
                          <h2 className="text-lg font-semibold text-[var(--color-fg)]">对阵图</h2>
                          <BracketView
                            data={bracketProjection.data}
                            themeColor={season.themeColor}
                            matchNodeMap={matchNodeMap}
                            seasonSlug={seasonSlug}
                          />
                        </section>
                      )}

                      {allStageMatches.length > 0 && (
                        <section className="space-y-3">
                          <MatchTabsSection
                            activeMatches={active}
                            doneMatches={done}
                            stage={stage.key}
                            seasonSlug={seasonSlug}
                            teamMap={teamMap}
                            unknownTeamName={isPlayoff ? "TBD" : "未知队伍"}
                          />
                        </section>
                      )}

                      {allStageMatches.length === 0 && (
                        <div className="text-center py-16 text-[var(--color-fg-mid)]">
                          {stage.name}赛程尚未生成
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </Panel>
      )}
    </div>
  );
}
