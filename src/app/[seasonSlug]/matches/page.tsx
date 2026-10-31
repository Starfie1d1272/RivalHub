import { hasUnconfiguredPublicScheduleMatches } from "@/lib/matches/schedule-read";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { projectBracketDisplayScores } from "@/lib/bracket/display-scores";
import { withDisplayScores } from "@/lib/matches/display-score-data";
import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { loadPublicMatchContexts } from "@/lib/matches/public-phase";
import { MatchContextRefresh } from "@/components/matches/MatchContextRefresh";
import { publicCompetitionEntryIdentityCondition } from "@/lib/competition-entries/public-visibility";
import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { majorFinalResults, matches, competitionEntries, competitionQualificationRuns } from "@/db/schema";
import { loadStageBracketState, serializeStageBracket } from "@/lib/bracket";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import Link from "next/link";
import { BracketView } from "@/components/matches/BracketView";
import { SwissBracket } from "@/components/matches/SwissBracket";
import { MatchTeamFilter } from "@/components/matches/MatchTeamFilter";
import { StandingsTable } from "@/components/matches/StandingsTable";
import {
  buildStageViews,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { calculateStageRoundRobinStandings } from "@/lib/matches/stage-standings";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { MatchTabsSection } from "@/components/matches/MatchTabsSection";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMatchMapRoundScores } from "@/lib/data/standings";
import { loadMajorSwissStageReadModel } from "@/lib/matches/stage-read-model";
import { loadQualificationSwissStageReadModel } from "@/lib/matches/qualification-stage-read-model";

interface MatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ team?: string; stage?: string }>;
}

export default function MatchesPage(props: MatchesPageProps) {
  return <Suspense fallback={<PageLayout variant="standard"><p role="status">赛程加载中…</p></PageLayout>}><MatchesContent {...props} /></Suspense>;
}

async function MatchesContent({ params, searchParams }: MatchesPageProps) {
  await io();
  const { seasonSlug } = await params;
  const { team: filterTeamId, stage: requestedStage } = await searchParams;

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const [allTeams, finalResult, stagePresentation, qualificationRun] = await Promise.all([
    db.query.competitionEntries.findMany({
      columns: { id: true, name: true, formationOrder: true },
      where: and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryIdentityCondition()),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
    getPublicSeasonStagePresentation(season),
    db.query.competitionQualificationRuns.findFirst({ where: eq(competitionQualificationRuns.seasonId, season.id) }),
  ]);
  const stagePlan = stagePresentation.stagePlan;
  const requestedMajorStageKey = requestedStage && stagePlan.some(stage => stage.key === requestedStage) ? requestedStage : null;
  const defaultStageKey = requestedStage === "play-in" && qualificationRun
    ? "play-in"
    : season.competitionTemplate === "major"
      ? requestedMajorStageKey ?? stagePresentation.currentStageKey ?? (qualificationRun ? "play-in" : stagePlan[0]?.key ?? null)
      : resolveDefaultStageKey(stagePlan, stagePresentation.initializedStageKeys.map(stage => ({ stage })), requestedStage);
  const selectedStage = stagePlan.find(stage => stage.key === defaultStageKey);
  const allMatchesRaw = defaultStageKey ? await db.query.matches.findMany({
    columns: { videoUrl: false, recordings: false, mvpWinnerUserId: false, createdAt: false, updatedAt: false },
    where: and(officialMatchCondition(), eq(matches.seasonId, season.id), eq(matches.stage, defaultStageKey)),
    orderBy: [asc(matches.completedAt), asc(matches.scheduledAt), asc(matches.id)],
  }) : [];
  const allMatches = await withDisplayScores(allMatchesRaw.map(requireCompetitionMatch));
  const needsBracket = selectedStage && ["round_robin", "single_elim", "double_elim"].includes(selectedStage.type);
  const [liveContexts, roundScoresByMatchId, swissEntries, qualificationSwissReadModel, bracketState, hasUnconfiguredMatches] = await Promise.all([
    loadPublicMatchContexts(allMatches),
    selectedStage?.type === "round_robin"
      ? getMatchMapRoundScores(allMatches.filter(match => match.status === "finished").map(match => match.id)) : Promise.resolve(new Map()),
    selectedStage?.type === "swiss"
      ? loadMajorSwissStageReadModel(season.id, selectedStage.key, allMatches).then(model => [[selectedStage.key, model] as const]) : Promise.resolve([]),
    defaultStageKey === "play-in" && qualificationRun?.format === "short_swiss_2w2l"
      ? loadQualificationSwissStageReadModel(season.id, { run: qualificationRun, displayedMatches: allMatches }) : Promise.resolve(null),
    needsBracket ? loadStageBracketState(db, season.id, selectedStage.key) : Promise.resolve(null),
    hasUnconfiguredPublicScheduleMatches(season.id, stagePlan.map(stage => stage.key), qualificationRun?.id),
  ]);
  const bracketDataByStage = new Map(bracketState && selectedStage ? [[selectedStage.key, serializeStageBracket(bracketState)]] : []);
  const swissReadModels = new Map(swissEntries.filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => entry[1] !== null));
  const selectedBracket = defaultStageKey ? bracketDataByStage.get(defaultStageKey) : null;
  const waitsForBracket = (selectedStage?.type === "single_elim" || selectedStage?.type === "double_elim") &&
    Boolean(selectedBracket?.stage.length && selectedBracket?.match.length);
  const teamMap = new Map(allTeams.map(team => [team.id, team.name]));
  const qualificationMatches = qualificationRun
    ? allMatches.filter((match) => match.qualificationRunId === qualificationRun.id &&
      match.stage === "play-in" && match.ownership === "manual" && match.majorStageRunId === null &&
      match.managedKey === null && match.bracketNodeId === null)
    : [];
  const qualificationMatchIds = new Set(qualificationMatches.map((match) => match.id));
  const majorStageMatches = allMatches.filter((match) => !qualificationMatchIds.has(match.id));
  const { views: stageViews } = buildStageViews<typeof allMatches[number]>(stagePlan, majorStageMatches);
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


  if (stagePresentation.initializedStageKeys.length === 0 && allTeams.length === 0) {
    return (
      <PageLayout variant="wide" className="py-16 text-center text-[var(--color-fg-mid)]">
        赛程尚未生成，敬请期待
      </PageLayout>
    );
  }

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <MatchContextRefresh enabled={defaultStageKey !== null && !["finished", "archived"].includes(season.status)} seasonSlug={seasonSlug} scope={{ stage: defaultStageKey ?? "" }} />
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

      {hasUnconfiguredMatches && (
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
          <div className="w-full">
            <nav aria-label="赛事阶段" className="mb-6 flex min-h-10 max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-1">
              {[...(qualificationRun ? [{ key: "play-in", label: "PLAY-IN" }] : []), ...stagePlan.map(stage => ({ key: stage.key, label: stagePresentation.labels[stage.key] ?? stage.name }))].map(stage => {
                const query = new URLSearchParams({ stage: stage.key });
                if (filterTeamId) query.set("team", filterTeamId);
                return <Link prefetch={false} key={stage.key} href={`/${seasonSlug}/matches?${query}`} aria-current={defaultStageKey === stage.key ? "page" : undefined}
                  className="shrink-0 rounded px-3 py-2 text-sm font-medium aria-[current=page]:bg-[var(--color-accent)] aria-[current=page]:text-[var(--color-accent-fg)]">{stage.label}</Link>;
              })}
            </nav>

            {qualificationRun && defaultStageKey === "play-in" && (
              <div className="space-y-8">
                {qualificationSwissReadModel && <SwissBracket data={qualificationSwissReadModel} seasonSlug={seasonSlug} />}
                {qualificationRun.format === "direct_bo3" && (() => {
                  const resolved = qualificationMatches.filter((match) => match.status === "finished" && match.scoreA !== null && match.scoreB !== null && match.scoreA !== match.scoreB).length;
                  const remaining = Math.max(0, qualificationRun.qualifierCount - resolved);
                  return <Panel contentClassName="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-[var(--color-fg)]">PLAY-IN · {qualificationRun.playInEntryCount} → {qualificationRun.qualifierCount} · BO3 决胜赛</p>
                      <p className="text-sm text-[var(--color-fg-mid)]">已决出 {resolved} 个晋级名额 · 剩余 {remaining}</p>
                    </div>
                  </Panel>;
                })()}
                {qualificationMatches.length > 0 ? (() => {
                  const { active, done } = splitMatches(qualificationMatches);
                  return <MatchTabsSection
                    activeMatches={active}
                    liveContexts={liveContexts}
                    doneMatches={done}
                    stageLabel="PLAY-IN"
                    seasonSlug={seasonSlug}
                    teamMap={teamMap}
                    highlightTeamId={filterTeamId}
                    isHistorical={season.status === "finished" || season.status === "archived"}
                    unknownTeamName="未知队伍"
                  />;
                })() : <div className="py-10 text-center text-sm text-[var(--color-fg-mid)]">Play-in 比赛尚未生成</div>}
              </div>
            )}

            {stageViews.filter(view => view.stage.key === defaultStageKey).map(({ stage, matches: allStageMatches }) => {
              const stageLabel = stagePresentation.labels[stage.key] ?? stage.name;
              const stageMatches = [...allStageMatches];
              const { active, done } = splitMatches(stageMatches);
              const swissReadModel = swissReadModels.get(stage.key);
              const standings = calculateStageRoundRobinStandings({
                stage,
                stageMatches: allStageMatches,
                entries: allTeams,
                roundScoresByMatchId,
                stageEntrantIds: bracketDataByStage.get(stage.key)?.participant.map((participant) => participant.rivalhubEntryId),
              });
              const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";
              const bracketData = isPlayoff ? bracketDataByStage.get(stage.key) ?? null : null;
              const matchNodeMap = new Map<string, string>(
                allStageMatches
                  .filter((match) => match.bracketNodeId !== null)
                  .map((match) => [match.bracketNodeId!, match.id]),
              );

              return (
                <div key={stage.key} className="space-y-8">
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
                            reportScheduleReady={waitsForBracket}
                            data={projectBracketDisplayScores(bracketData, allStageMatches)}
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
                            liveContexts={liveContexts}
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
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      {!waitsForBracket && <ContentReady module="schedule" phase="primary" />}
    </PageLayout>
  );
}
