import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { majorFinalResults, matches, competitionEntries } from "@/db/schema";
import { loadStageBracketViews } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BracketView } from "@/components/matches/BracketView";
import { SwissBracket } from "@/components/matches/SwissBracket";
import { MatchTeamFilter } from "@/components/matches/MatchTeamFilter";
import { StandingsTable } from "@/components/matches/StandingsTable";
import {
  buildStageViews,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { resolveStrictHistoricalRoundRobinEntryIds } from "@/lib/matches/historical-round-robin";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { MatchTabsSection } from "@/components/matches/MatchTabsSection";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMatchMapRoundScores } from "@/lib/data/standings";
import { loadMajorSwissStageReadModel } from "@/lib/matches/stage-read-model";

interface MatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ team?: string }>;
}

export default async function MatchesPage({ params, searchParams }: MatchesPageProps) {
  const { seasonSlug } = await params;
  const { team: filterTeamId } = await searchParams;

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const [allTeams, allMatches, finalResult, stagePresentation] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition()),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.completedAt), asc(matches.scheduledAt), asc(matches.id)],
    }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
    getPublicSeasonStagePresentation(season),
  ]);

  const teamMap = new Map(allTeams.map((team) => [team.id, team.name]));
  const roundScoresByMatchId = await getMatchMapRoundScores(
    allMatches.filter((match) => match.status === "finished").map((match) => match.id),
  );
  const stagePlan = stagePresentation.stagePlan;
  const { views: stageViews, unconfiguredMatches } = buildStageViews<typeof allMatches[number]>(stagePlan, allMatches);
  const swissReadModels = new Map(
    (await Promise.all(
      stagePlan
        .filter((stage) => stage.type === "swiss")
        .map(async (stage) => [
          stage.key,
          await loadMajorSwissStageReadModel(season.id, stage.key),
        ] as const),
    )).filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => entry[1] !== null),
  );
  const sortActiveMatches = (stageMatches: typeof allMatches) =>
    [...stageMatches].sort((a, b) => {
      const timeDifference = (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity);
      return timeDifference || a.id.localeCompare(b.id);
    });
  const sortDoneMatches = (stageMatches: typeof allMatches) =>
    [...stageMatches].sort((a, b) => {
      const timeDifference = (b.completedAt ?? b.scheduledAt)?.getTime() ?? 0;
      const otherTime = (a.completedAt ?? a.scheduledAt)?.getTime() ?? 0;
      return timeDifference - otherTime || b.id.localeCompare(a.id);
    });
  const splitMatches = (stageMatches: typeof allMatches) => ({
    active: sortActiveMatches(
      stageMatches.filter((match) => match.status !== "finished" && match.status !== "cancelled"),
    ),
    done: sortDoneMatches(
      stageMatches.filter((match) => match.status === "finished" || match.status === "cancelled"),
    ),
  });

  const bracketDataByStage = await loadStageBracketViews(db, season.id);
  const defaultStageKey = resolveDefaultStageKey(stagePlan, allMatches);

  if (allMatches.length === 0 && allTeams.length === 0) {
    return (
      <PageLayout variant="standard" className="py-16 text-center text-[var(--color-fg-mid)]">
        赛程尚未生成，敬请期待
      </PageLayout>
    );
  }

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <PageHeader
        title="赛程"
        eyebrow={season.name}
        actions={(
          <Suspense fallback={null}>
            <AdminShortcutSlot href={`/admin/${seasonSlug}/matches`} />
          </Suspense>
        )}
      />

      {allTeams.length > 0 && (
        <MatchTeamFilter teams={allTeams.map((team) => ({ id: team.id, name: team.name }))} />
      )}

      {unconfiguredMatches.length > 0 && (
        <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">
            部分赛程数据与当前阶段配置不一致。
          </p>
        </Panel>
      )}

      {finalResult?.status === "pending_confirmation" && (
        <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">淘汰赛已结束，冠军和正式名次正在等待赛事方确认。</p>
        </Panel>
      )}

      {defaultStageKey && (
        <Panel contentClassName="p-6">
          <Tabs defaultValue={defaultStageKey} className="w-full">
            <TabsList className="mb-6 max-w-full justify-start overflow-x-auto bg-[var(--color-panel)] border border-[var(--color-border)] p-1">
              {stageViews.map(({ stage }) => (
                <TabsTrigger
                  key={stage.key}
                  value={stage.key}
                  className="data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-accent-fg)]"
                >
                  {stagePresentation.labels[stage.key]}
                </TabsTrigger>
              ))}
            </TabsList>

            {stageViews.map(({ stage, matches: allStageMatches }) => {
              const stageLabel = stagePresentation.labels[stage.key] ?? stage.name;
              const stageMatches = [...allStageMatches];
              const { active, done } = splitMatches(stageMatches);
              const swissReadModel = swissReadModels.get(stage.key);
              const standings = stage.type === "round_robin" && allStageMatches.length > 0
                ? (() => {
                    const providerEntryIds = bracketDataByStage.get(stage.key)?.participant.map((participant) => participant.rivalhubEntryId) ?? [];
                    const entryIds = providerEntryIds.length > 0
                      ? providerEntryIds
                      : resolveStrictHistoricalRoundRobinEntryIds(stage.teamCount, allStageMatches);
                    if (!entryIds) return [];
                    const stageEntries = allTeams.filter((team) => entryIds.includes(team.id));
                    return calculateStandings(
                      stageEntries,
                      allStageMatches.filter((match) => match.status === "finished"),
                      roundScoresByMatchId,
                    );
                  })()
                : [];
              const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";
              const bracketData = isPlayoff ? bracketDataByStage.get(stage.key) ?? null : null;
              const matchNodeMap = new Map<string, string>(
                allStageMatches
                  .filter((match) => match.bracketNodeId !== null)
                  .map((match) => [match.bracketNodeId!, match.id]),
              );

              return (
                <TabsContent key={stage.key} value={stage.key} className="space-y-8">
                  <>
                      {swissReadModel && (
                        <SwissBracket data={swissReadModel} seasonSlug={seasonSlug} />
                      )}
                      {standings.length > 0 && (
                        <section className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-[var(--color-fg)]">积分榜</h2>
                          </div>
                          <StandingsTable
                            standings={standings}
                            seasonSlug={seasonSlug}
                            isFinal={season.status === "finished" || season.status === "archived"}
                          />
                        </section>
                      )}

                      {bracketData && bracketData.stage.length > 0 && (
                        <section className="space-y-3">
                          <h2 className="text-lg font-semibold text-[var(--color-fg)]">对阵图</h2>
                          <BracketView
                            data={bracketData}
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
                            stageLabel={stageLabel}
                            seasonSlug={seasonSlug}
                            teamMap={teamMap}
                            highlightTeamId={filterTeamId}
                            isHistorical={season.status === "finished" || season.status === "archived"}
                            unknownTeamName={isPlayoff ? "待定" : "未知队伍"}
                          />
                        </section>
                      )}

                      {allStageMatches.length === 0 && (
                        <div className="text-center py-16 text-[var(--color-fg-mid)]">
                          {stageLabel} 赛程尚未生成
                        </div>
                      )}
                  </>
                </TabsContent>
              );
            })}
          </Tabs>
        </Panel>
      )}
    </PageLayout>
  );
}
