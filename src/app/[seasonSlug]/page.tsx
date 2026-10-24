import { ContentReady } from "@/components/telemetry/ContentReady";
import { getOfficialUpcomingMatches, getQualificationMatchProgress } from "@/lib/seasons/overview-read-model";
import { getOfficialSeasonMatchSummary } from "@/lib/matches/read-official";
import { getApprovedCompetitionEntryCount } from "@/lib/competition-entries/counts";
import { seasonEntries } from "@/lib/seasons/entries";
import { buildSeasonPrimaryAction } from "@/lib/home/navigation";
import { io } from "next/cache";
import { EventLogo } from "@/components/season/EventLogo";
import { SeasonDraftPreview, SeasonMatchPreview, SeasonVotingPreview } from "@/components/season/SeasonStageHighlights";
import { getPublicCaptainVotingData } from "@/lib/captains/data";
import { getPublicDraftSummary } from "@/lib/draft/data";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { SeasonResults } from "@/components/season/SeasonResults";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";
import { SeasonNextStep } from "@/components/season/SeasonNextStep";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Vote, Users, Swords, Shuffle, BarChart3, UserRoundSearch, Trophy, Info } from "lucide-react";
import { formatCSTDateTime } from "@/lib/utils/date";
import type { SeasonStatus } from "@/types/season";
import { showStats } from "@/lib/utils/season";
import {
  presentRegistrationSchedule,
  presentSeasonParticipationState,
  presentSeasonKind,
  presentStageMarker,
} from "@/lib/seasons/presentation";
import { PageLayout, StatusPill, Panel, ScrollHint, PhaseStep } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { getStandings } from "@/lib/data/standings";
import { getParticipantSummary } from "@/lib/participants/summary";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantOverview } from "@/lib/major/public-participants";
import { RegistrationScheduleCountdown } from "@/components/seasons/RegistrationScheduleCountdown";
import { getLatestSeasonAnnouncement } from "@/lib/announcements/read-model";
import { toAnnouncementExcerpt } from "@/lib/announcements/presentation";
import { getPublicSeasonInfo } from "@/lib/season-public-info/read-model";
import { hasPublicSeasonInfo, activeGroupCount } from "@/lib/season-public-info/presentation";
import type { PublicSeason } from "@/lib/data/public-seasons";

const STATUS_IDX: Record<SeasonStatus, number> = {
  draft: 0, registration: 1, voting: 2, drafting: 3,
  playing: 4, finished: 5, archived: 6,
};

interface SeasonPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default function SeasonPage({ params }: SeasonPageProps) {
  return (
    <Suspense fallback={<SeasonPageFallback />}>
      <SeasonPageContent params={params} />
    </Suspense>
  );
}

export async function SeasonPageContent({ params }: SeasonPageProps) {
  await io();
  const { seasonSlug } = await params;

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const isHistorical = ["finished", "archived"].includes(season.status);
  const isMajor = season.competitionTemplate === "major";
  const stagePresentationRead = getPublicSeasonStagePresentation(season);
  const [stagePresentation,
    majorParticipantOverview, teamCount, participantSummary, matchCountRow,
    upcomingMatches, standings, captainVoting, draftData, qualificationProgress] = await Promise.all([
    stagePresentationRead,
    isMajor ? getMajorPublicParticipantOverview(season) : Promise.resolve(null),
    isMajor ? Promise.resolve(0) : getApprovedCompetitionEntryCount(season.id),
    isMajor ? Promise.resolve(null) : getParticipantSummary(season),
    getOfficialSeasonMatchSummary(season.id),
    season.hasOfficialMatches && !isHistorical ? getOfficialUpcomingMatches(season.id) : Promise.resolve([]),
    season.status === "playing" && !isMajor ? getStandings(season.id) : Promise.resolve([]),
    season.status === "voting" && season.hasCaptainVoting ? getPublicCaptainVotingData(season.id) : Promise.resolve(null),
    season.status === "drafting" && season.hasDraft ? getPublicDraftSummary(season.id) : Promise.resolve(null),
    stagePresentationRead.then(presentation => isMajor && presentation.qualificationRun && !presentation.stagePlan.some(stage => stage.key === presentation.currentStageKey || presentation.initializedStageKeys.includes(stage.key))
      ? getQualificationMatchProgress(presentation.qualificationRun.id) : null),
  ]);
  const stagePlan = stagePresentation.stagePlan;
  const stageLabelByKey = new Map(Object.entries(stagePresentation.labels));
  const hasMatches = stagePresentation.officialStages.length > 0;
  const initializedStages = new Set(stagePresentation.initializedStageKeys);
  const qualificationRun = isMajor ? stagePresentation.qualificationRun ?? null : null;
  const mainEventStarted = stagePlan.some((stage) => stage.key === stagePresentation.currentStageKey || initializedStages.has(stage.key));
  const qualificationBeforeMainStart = Boolean(qualificationRun) && !mainEventStarted;
  const publicTeamCount = majorParticipantOverview?.teamCount ?? teamCount;
  const publicPlayerCount = majorParticipantOverview?.playerCount ?? participantSummary?.count ?? 0;
  const qualificationCurrentRound = qualificationProgress?.currentRound ?? 1;
  const finalMainEntrantsConfirmed = qualificationRun !== null &&
    (majorParticipantOverview?.officialEntrantCount ?? 0) === qualificationRun.targetEntrantCount;

  // ── 动态阶段列表 ──────────────────────────────────────────
  interface Phase {
    key: string;
    label: string;
    done: boolean;
  }

  const currentStatusIdx = STATUS_IDX[season.status];
  const phases: Phase[] = [];

  // 赛前阶段（capability 驱动）
  const preMatchRules: { key: string; label: string; doneAfter: SeasonStatus }[] = [
    { key: "register", label: "REGISTER", doneAfter: "registration" },
  ];
  if (season.hasCaptainVoting) {
    preMatchRules.push({ key: "vote", label: "VOTE", doneAfter: "voting" });
  }
  if (season.hasDraft) {
    preMatchRules.push({ key: "draft", label: "DRAFT", doneAfter: "drafting" });
  }
  for (const rule of preMatchRules) {
    phases.push({
      key: rule.key,
      label: rule.label,
      done: (qualificationBeforeMainStart && rule.key === "register") || currentStatusIdx > STATUS_IDX[rule.doneAfter],
    });
  }

  if (qualificationRun) phases.push({ key: "play-in", label: "PLAY-IN", done: Boolean(qualificationRun.completedAt) });

  // 比赛阶段（从 stagePlan 读取）
  if (stagePlan.length > 0) {
    const PLAYING_IDX = STATUS_IDX.playing;
    let currentMatchIdx = -1;

    if (currentStatusIdx < PLAYING_IDX) {
      // 尚未进入 playing —— 没有 match stage 开始
    } else if (currentStatusIdx > PLAYING_IDX) {
      // finished / archived → 所有阶段完成
      currentMatchIdx = stagePlan.length;
    } else {
      // 恰好 playing → 找到最后一个已初始化的阶段
      let lastInit = -1;
      for (let i = stagePlan.length - 1; i >= 0; i--) {
        if (initializedStages.has(stagePlan[i].key)) { lastInit = i; break; }
      }
      currentMatchIdx = Math.max(0, lastInit);
    }

    for (let i = 0; i < stagePlan.length; i++) {
      const stage = stagePlan[i];
      phases.push({
        key: stage.key,
        label: presentStageMarker(stage, season.competitionTemplate),
        done: i < currentMatchIdx,
      });
    }
  }

  // 结束标记
  phases.push({
    key: "finished",
    label: "FINISHED",
    done: currentStatusIdx >= STATUS_IDX.finished,
  });

  // 找当前阶段（第一个未完成的）
  let currentPhaseIdx = ["finished", "archived"].includes(season.status) ? phases.findIndex(phase => phase.key === "finished") : stagePresentation.currentStageKey ? phases.findIndex(phase => phase.key === stagePresentation.currentStageKey) : phases.findIndex((p) => !p.done);
  if (currentPhaseIdx === -1 && !qualificationBeforeMainStart) currentPhaseIdx = phases.length - 1;

  const primaryAction = buildSeasonPrimaryAction({ ...season, hasMatches });
  const primaryHref = primaryAction.href === `/${seasonSlug}` && isHistorical ? "#results" : primaryAction.href;
  const registrationSchedule = !season.hasOfficialMatches && !qualificationRun ? presentRegistrationSchedule(season) : null;
  const participationState = presentSeasonParticipationState(season);
  const heroStageLabel = !isHistorical ? stagePresentation.currentStageLabel : null;
  const teamCountLabel = majorParticipantOverview?.phase === "approved_candidates" ? "已审核队伍" : "参赛队伍";
  const showCurrentMatches = !isHistorical && Boolean(season.hasOfficialMatches || qualificationRun);
  const showRegistrationSummary = season.status === "registration" && !season.hasOfficialMatches && !qualificationRun && primaryAction.key !== "teams";
  const entryIcons = { captains: Vote, draft: Shuffle, matches: Swords, teams: Users, players: UserRoundSearch, stats: BarChart3, awards: Trophy, bet: Trophy, predictions: Shuffle, info: Info, overview: Swords };
  const relatedEntries = seasonEntries({ ...season, hasMatches, hasStats: showStats(season), hasPredictions: isMajor })
    .filter((entry) => entry.canRead && !["overview", "matches", "info"].includes(entry.key) && entry.key !== primaryAction.key)
    .sort((a, b) => a.featuredPriority - b.featuredPriority)
    .slice(0, 4);
  const participationKeys = new Set(["captains", "draft", "bet", "predictions", "awards"]);
  const relatedGroups = [
    { label: isHistorical ? "赛事回顾" : "参与赛事", entries: relatedEntries.filter((entry) => participationKeys.has(entry.key)) },
    { label: "赛事资料", entries: relatedEntries.filter((entry) => !participationKeys.has(entry.key)) },
  ].filter((group) => group.entries.length > 0);

  return (
    <PageLayout variant="wide" className="space-y-5">
      <ContentReady module="public" phase="primary" />
      <section aria-labelledby="season-title" className="home-event-hero relative overflow-hidden rounded-[var(--radius-display)] border border-[var(--color-border)] px-5 py-5 sm:px-7">
        <div className="relative z-10 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <StatusPill
                label={heroStageLabel ? qualificationBeforeMainStart && qualificationRun?.completedAt ? "Play-in 已结束" : heroStageLabel : participationState.label}
                tone={heroStageLabel ? "accent" : participationState.tone}
              />
              <span className="font-mono uppercase tracking-wider text-[var(--color-fg-dim)]">{presentSeasonKind(season.kind)}</span>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-3">
              <EventLogo logoUrl={season.logoUrl} className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14" />
              <h1 id="season-title" className="min-w-0 text-3xl font-bold leading-tight text-[var(--color-fg)] sm:text-4xl [overflow-wrap:anywhere]">
                {season.name}
              </h1>
              <Suspense fallback={null}>
                <AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} />
              </Suspense>
            </div>
            <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--color-fg-mid)]">
              {(season.registrationMode === "team" || publicTeamCount > 0) && (
                <div className="flex items-baseline gap-2">
                  <dt>{teamCountLabel}</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums text-[var(--color-fg)]">{publicTeamCount}</dd>
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <dt>选手</dt>
                <dd className="font-mono text-base font-semibold tabular-nums text-[var(--color-fg)]">{publicPlayerCount}</dd>
              </div>
              {(matchCountRow?.total ?? 0) > 0 && (
                <div className="flex items-baseline gap-2">
                  <dt>已完成比赛</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums text-[var(--color-fg)]">
                    {matchCountRow?.finished ?? 0}<span className="text-xs font-normal text-[var(--color-fg-dim)]"> / {matchCountRow?.total}</span>
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <div className="flex flex-col items-start gap-3 lg:max-w-72 lg:items-end">
            <Button size="lg" asChild>
              <Link href={primaryHref as import("next").Route}>{primaryAction.label} <span aria-hidden>→</span></Link>
            </Button>
            {registrationSchedule && (
              <div className="space-y-1 text-xs text-[var(--color-fg-mid)] lg:text-right">
                <p>{registrationSchedule.primary}</p>
                {registrationSchedule.secondary && <p>{registrationSchedule.secondary}</p>}
                <RegistrationScheduleCountdown target={registrationSchedule.countdownTarget} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Preserve the established numbered phase tracker as the full-width orientation anchor. */}
      <Panel contentClassName="p-6">
        <ScrollHint fromColor="var(--color-panel)">
          <div role="list" aria-label="赛事阶段" className="flex items-start">
            {phases.map((phase, i) => (
              <PhaseStep
                key={phase.key}
                label={phase.label}
                stepNumber={i + 1}
                isDone={phase.done}
                isCurrent={i === currentPhaseIdx}
                isLast={i === phases.length - 1}
              />
            ))}
          </div>
        </ScrollHint>
      </Panel>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
        <div className="min-w-0 space-y-4">
          {isHistorical && <Suspense fallback={<section id="results" aria-busy="true" className="min-h-64">赛事结果加载中…</section>}>
            <SeasonHistoricalResults season={season} />
          </Suspense>}

          {showCurrentMatches && (
            <Panel label={
              <div className="flex w-full items-center justify-between gap-3">
                <h2>{qualificationBeforeMainStart ? "PLAY-IN" : "近期比赛"}</h2>
                <Link href={qualificationBeforeMainStart ? `/${seasonSlug}/matches?stage=play-in` : `/${seasonSlug}/matches`} className="inline-flex min-h-7 items-center text-[var(--color-accent)] hover:underline">
                  {qualificationBeforeMainStart ? "Play-in 赛程" : "全部赛程"} <span aria-hidden className="ml-1">→</span>
                </Link>
              </div>
            }>
              {qualificationRun && !mainEventStarted && (
                <div className={upcomingMatches.length > 0 ? "mb-4 space-y-1 border-b border-[var(--color-border)] pb-3" : "space-y-1"}>
                  <p className="font-semibold text-[var(--color-fg)]">
                    {!qualificationRun.startedAt ? "Play-in · 赛程待生成" : qualificationRun.completedAt ? "Play-in 已结束" : `Play-in · 第 ${qualificationCurrentRound} 轮`}
                  </p>
                  <p className="text-sm text-[var(--color-fg-mid)]">
                    {qualificationRun.completedAt
                      ? `${qualificationRun.qualifierCount} 支队伍晋级 · 正赛名单${finalMainEntrantsConfirmed ? "已确认" : "待确认"}`
                      : qualificationRun.startedAt
                        ? `${qualificationRun.playInEntryCount} 支队伍争夺 ${qualificationRun.qualifierCount} 个正赛席位`
                        : `${qualificationRun.candidateCount} 支候选 · ${qualificationRun.playInEntryCount} 支参加 Play-in · ${qualificationRun.targetEntrantCount} 支进入正赛`}
                  </p>
                  {!qualificationRun.startedAt && <p className="text-xs text-[var(--color-fg-dim)]">{qualificationRun.format === "direct_bo3" ? "BO3 决胜赛" : "Short Swiss · BO1 · 2 胜晋级 / 2 负淘汰"}</p>}
                </div>
              )}
              {(upcomingMatches.length > 0 || !qualificationBeforeMainStart) && (
                <SeasonMatchPreview
                  seasonSlug={seasonSlug}
                  matches={upcomingMatches.map((match) => ({
                    ...match,
                    stageLabel: (match.stage === null ? undefined : stageLabelByKey.get(match.stage)) ?? "比赛阶段",
                  }))}
                />
              )}
            </Panel>
          )}

          {captainVoting && (
            <Panel label={
              <div className="flex w-full items-center justify-between gap-3">
                <h2>队长投票</h2>
                <Link href={`/${seasonSlug}/captains`} className="inline-flex min-h-7 items-center text-[var(--color-accent)] hover:underline">全部候选 <span aria-hidden className="ml-1">→</span></Link>
              </div>
            }>
              <SeasonVotingPreview candidates={captainVoting.candidates.slice(0, 4).map((candidate) => ({ userId: candidate.userId, name: candidate.displayName, voteCount: candidate.voteCount }))} />
            </Panel>
          )}

          {season.status === "drafting" && season.hasDraft && (
            <Panel label={<h2>选秀进度</h2>}>
              <SeasonDraftPreview seasonSlug={seasonSlug} draftData={draftData} />
            </Panel>
          )}

          {showRegistrationSummary && (
            <Panel label={<h2>参赛方式</h2>}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-[var(--color-fg)]">{season.registrationMode === "team" ? "组队参赛" : "个人参赛"}</p>
                  <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                    {season.registrationMode === "team"
                      ? `${season.minTeamSize === season.maxTeamSize ? season.minTeamSize : `${season.minTeamSize}–${season.maxTeamSize}`} 人名单，由赛事负责人提交报名。`
                      : season.hasDraft ? "个人报名，通过选秀组成队伍。" : "以个人身份报名本届赛事。"}
                  </p>
                </div>
                {season.registrationMode === "team" && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/teams/recruitment">寻找队伍或队友 <span aria-hidden>→</span></Link>
                  </Button>
                )}
              </div>
            </Panel>
          )}

          <Suspense fallback={null}>
            <SeasonPersonalNextStep season={season} />
          </Suspense>

          {standings.length > 0 && (
            <Panel label={
              <div className="flex w-full items-center justify-between gap-3">
                <h2>当前排名 · TOP 4</h2>
                <Link href={`/${seasonSlug}/matches`} className="inline-flex min-h-7 items-center text-[var(--color-accent)] hover:underline">完整排名 <span aria-hidden className="ml-1">→</span></Link>
              </div>
            }>
              <StandingsTable standings={standings.slice(0, 4)} seasonSlug={seasonSlug} isFinal={false} />
            </Panel>
          )}

          {relatedGroups.length > 0 && (
            <Panel label={<h2>相关入口</h2>} contentClassName="grid gap-4 sm:grid-cols-2">
              {relatedGroups.map((group) => (
                <nav key={group.label} aria-label={group.label}>
                  <h3 className="mb-1 text-xs text-[var(--color-fg-dim)]">{group.label}</h3>
                  <div className="divide-y divide-[var(--color-border)]">
                    {group.entries.map((entry) => {
                      const Icon = entryIcons[entry.key];
                      return (
                        <Link key={entry.key} href={entry.href as import("next").Route} className="group flex min-h-10 items-center gap-3 py-2 text-sm text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">
                          <Icon size={16} aria-hidden />
                          <span className="min-w-0 flex-1 font-medium">{entry.label}</span>
                          <span aria-hidden>→</span>
                        </Link>
                      );
                    })}
                  </div>
                </nav>
              ))}
            </Panel>
          )}
        </div>

        <Suspense fallback={<aside aria-label="赛事公告与相关信息" aria-busy="true" className="min-h-64" />}>
          <SeasonInformation season={season} />
        </Suspense>
      </div>
    </PageLayout>
  );
}

async function SeasonPersonalNextStep({ season }: { season: PublicSeason }) {
  const task = await getSeasonPersonalNextStep(season);
  return <SeasonNextStep task={task} />;
}

function SeasonPageFallback() {
  return (
    <PageLayout variant="wide" className="min-h-[60vh]" aria-busy="true">
      <span className="sr-only">正在加载赛事首页…</span>
    </PageLayout>
  );
}

async function SeasonHistoricalResults({ season }: { season: PublicSeason }) {
  const results = await getPublicSeasonResults(season);
  return <div id="results" className="scroll-mt-28"><SeasonResults results={results} slug={season.slug} /></div>;
}

async function SeasonInformation({ season }: { season: PublicSeason }) {
  const seasonSlug = season.slug;
  const [latestSeasonAnnouncement, seasonInfo] = await Promise.all([
    getLatestSeasonAnnouncement(season.id), getPublicSeasonInfo(season.id),
  ]);
  const hasSeasonInfo = hasPublicSeasonInfo(seasonInfo);
  const groupCount = activeGroupCount(seasonInfo);
  return (
        <aside aria-label="赛事公告与相关信息" className="min-w-0 space-y-4">
          {latestSeasonAnnouncement && (
            <Panel label={
              <div className="flex w-full items-center justify-between gap-3">
                <h2>最新公告</h2>
                <Link href={`/${seasonSlug}/announcements`} className="inline-flex min-h-7 items-center text-[var(--color-accent)] hover:underline">全部 <span aria-hidden className="ml-1">→</span></Link>
              </div>
            }>
              <Link href={`/${seasonSlug}/announcements`} className="font-semibold leading-relaxed text-[var(--color-fg)] hover:text-[var(--color-accent)]">{latestSeasonAnnouncement.title}</Link>
              <p className="mt-2 text-xs text-[var(--color-fg-dim)]">{formatCSTDateTime(latestSeasonAnnouncement.publishedAt)}</p>
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--color-fg-mid)]">{toAnnouncementExcerpt(latestSeasonAnnouncement.body)}</p>
            </Panel>
          )}

          {hasSeasonInfo && (
            <Panel label={<h2>赛事信息</h2>}>
              <div className="space-y-3 text-sm">
                <Link href={`/${seasonSlug}/info`} className="block font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]">{seasonInfo.rules.label} <span aria-hidden>→</span></Link>
                {(groupCount > 0 || seasonInfo.contacts.length > 0) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-[var(--color-fg-mid)]">
                    {groupCount > 0 && <Link href={`/${seasonSlug}/info`} className="hover:text-[var(--color-accent)]">交流群 · {groupCount}</Link>}
                    {seasonInfo.contacts.length > 0 && <Link href={`/${seasonSlug}/info`} className="hover:text-[var(--color-accent)]">联系负责人</Link>}
                  </div>
                )}
              </div>
            </Panel>
          )}
        </aside>
  );
}
