import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { seasonEntries } from "@/lib/seasons/entries";
import { connection } from "next/server";
import { officialMatchCondition } from "@/lib/matches/scope";
import { EventLogo } from "@/components/season/EventLogo";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import type { MatchStatus } from "@/types/match";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { SeasonResults } from "@/components/season/SeasonResults";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";
import { SeasonNextStep } from "@/components/season/SeasonNextStep";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import Link from "next/link";
import { Fragment, Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { eq, count, or, and, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { UserPlus, Vote, Users, Swords, Shuffle, BarChart3, UserRoundSearch, Trophy } from "lucide-react";
import { db } from "@/db/client";
import { matches, competitionEntries, majorTournamentEntrants } from "@/db/schema";
import { formatCSTDateTime } from "@/lib/utils/date";
import type { SeasonStatus } from "@/types/season";
import { showStats } from "@/lib/utils/season";
import {
  presentRegistrationSchedule,
  presentSeasonParticipationState,
  presentSeasonKind,
  presentStageMarker,
} from "@/lib/seasons/presentation";
import { PageLayout, SectionHeader, StatusPill, Panel, ScrollHint, Stat, PhaseStep } from "@/components/rivalhub";
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
  await connection();
  const { seasonSlug } = await params;

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const [latestSeasonAnnouncement, seasonInfo] = await Promise.all([
    getLatestSeasonAnnouncement(season.id),
    getPublicSeasonInfo(season.id),
  ]);
  const results = ["finished", "archived"].includes(season.status) ? await getPublicSeasonResults(season) : null;
  const stagePresentation = await getPublicSeasonStagePresentation(season);
  const stagePlan = stagePresentation.stagePlan;
  const stageLabelByKey = new Map(Object.entries(stagePresentation.labels));
  const hasMatches = stagePresentation.officialStages.length > 0;

  const initializedStages = new Set(stagePresentation.initializedStageKeys);

  // ── 统计数据 + 即将到来的比赛 ────────────────────────────────────────
  const teamA = alias(competitionEntries, "team_a");
  const teamB = alias(competitionEntries, "team_b");

  const upcomingMatchesQuery = season.hasOfficialMatches && !["finished", "archived"].includes(season.status)
    ? db
        .select({
          id: matches.id,
          entryAId: matches.entryAId,
          entryBId: matches.entryBId,
          status: matches.status,
          scheduledAt: matches.scheduledAt,
          stage: matches.stage,
          teamAName: teamA.name,
          teamBName: teamB.name,
        })
        .from(matches)
        .leftJoin(teamA, eq(matches.entryAId, teamA.id))
        .leftJoin(teamB, eq(matches.entryBId, teamB.id))
        .where(
          and(officialMatchCondition(), and(
            eq(matches.seasonId, season.id),
            or(eq(matches.status, "scheduled"), eq(matches.status, "in_progress"))
          ))
        )
        .orderBy(sql`case when ${matches.status} = 'in_progress' then 0 when ${matches.scheduledAt} is not null then 1 else 2 end`, matches.scheduledAt)
        .limit(4)
    : null;

  const isMajor = season.competitionTemplate === "major";
  const [majorParticipantOverview, [teamCountRow], participantSummary, [matchCountRow], upcomingMatches, standings, [finalMainEntrantCountRow]] =
    await Promise.all([
      isMajor ? getMajorPublicParticipantOverview(season) : Promise.resolve(null),
      isMajor
        ? Promise.resolve([] as { value: number }[])
        : db.select({ value: count() }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition())),
      isMajor ? Promise.resolve(null) : getParticipantSummary(season),
      db.select({
        total: count(),
        finished: sql<number>`count(*) filter (where ${matches.status} = 'finished')`,
      }).from(matches).where(and(officialMatchCondition(), eq(matches.seasonId, season.id))),
      upcomingMatchesQuery ?? Promise.resolve([] as { id: string; entryAId: string | null; entryBId: string | null; status: string; scheduledAt: Date | null; stage: string; teamAName: string | null; teamBName: string | null }[]),
      season.status === "playing" && !isMajor ? getStandings(season.id) : Promise.resolve([]),
      isMajor
        ? db.select({ value: count() }).from(majorTournamentEntrants).where(eq(majorTournamentEntrants.seasonId, season.id))
        : Promise.resolve([] as { value: number }[]),
    ]);
  const qualificationRun = isMajor ? stagePresentation.qualificationRun ?? null : null;
  const qualificationMatches = qualificationRun
    ? await db.select({ status: matches.status, round: matches.round }).from(matches).where(and(officialMatchCondition(), eq(matches.qualificationRunId, qualificationRun.id)))
    : [];
  const mainEventStarted = stagePlan.some((stage) => stage.key === stagePresentation.currentStageKey || initializedStages.has(stage.key));
  const qualificationBeforeMainStart = Boolean(qualificationRun) && !mainEventStarted;
  const publicTeamCount = majorParticipantOverview?.teamCount ?? Number(teamCountRow?.value ?? 0);
  const publicPlayerCount = majorParticipantOverview?.playerCount ?? participantSummary?.count ?? 0;
  const incompleteQualificationRounds = qualificationMatches
    .filter((match) => match.status !== "finished" && match.round !== null)
    .map((match) => match.round!);
  const qualificationCurrentRound = incompleteQualificationRounds.length > 0
    ? Math.min(...incompleteQualificationRounds)
    : Math.max(0, ...qualificationMatches.map((match) => match.round ?? 0)) + 1;
  const finalMainEntrantsConfirmed = qualificationRun !== null &&
    Number(finalMainEntrantCountRow?.value ?? 0) === qualificationRun.targetEntrantCount;

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
    done: currentStatusIdx > STATUS_IDX.finished,
  });

  // 找当前阶段（第一个未完成的）
  let currentPhaseIdx = ["finished", "archived"].includes(season.status) ? phases.findIndex(phase => phase.key === "finished") : stagePresentation.currentStageKey ? phases.findIndex(phase => phase.key === stagePresentation.currentStageKey) : phases.findIndex((p) => !p.done);
  if (currentPhaseIdx === -1 && !qualificationBeforeMainStart) currentPhaseIdx = phases.length - 1;

  const isHistorical = ["finished", "archived"].includes(season.status);
  const registrationSchedule = presentRegistrationSchedule(season);
  const entryIcons = { captains: Vote, draft: Shuffle, matches: Swords, teams: Users, players: UserRoundSearch, stats: BarChart3, awards: Trophy, bet: Trophy, predictions: Shuffle, info: UserPlus, overview: Swords };
  const quickLinks = seasonEntries({ ...season, hasMatches, hasStats: showStats(season), hasPredictions: isMajor }).filter(entry => entry.canRead && entry.key !== "overview").map(entry => ({ ...entry, description: "", icon: entryIcons[entry.key] }));

  return (
    <PageLayout variant="wide" className="space-y-8">
      <div className="relative overflow-hidden rounded-[var(--radius-display)] border border-[var(--color-border)] bg-[var(--color-panel)] px-6 py-8 sm:px-8 sm:py-10">
        <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-wider">
          <StatusPill label={!isHistorical && stagePresentation.currentStageLabel ? stagePresentation.currentStageLabel : presentSeasonParticipationState(season).label} tone={!isHistorical && stagePresentation.currentStageLabel ? "accent" : presentSeasonParticipationState(season).tone} />
          <span className="text-[var(--color-fg-dim)]">{presentSeasonKind(season.kind)}</span>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <EventLogo logoUrl={season.logoUrl} />
          <h1 className="min-w-0 text-4xl sm:text-5xl font-bold text-[var(--color-fg)] leading-tight">
            {season.name}
          </h1>
          <Suspense fallback={null}>
            <AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} />
          </Suspense>
        </div>
        {registrationSchedule && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-fg-mid)]">
            <span>{registrationSchedule.primary}</span>
            {registrationSchedule.secondary && <span>{registrationSchedule.secondary}</span>}
            <RegistrationScheduleCountdown target={registrationSchedule.countdownTarget} />
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <SeasonPersonalNextStep season={season} />
      </Suspense>
      {results && <SeasonResults results={results} slug={seasonSlug} />}

      {/* Phase tracker */}
      <Panel contentClassName="px-5 py-3">
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

      {qualificationRun && !mainEventStarted && (
        <Panel label="PLAY-IN" contentClassName="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              {!qualificationRun.startedAt ? (
                <>
                  <p className="font-medium text-[var(--color-fg)]">{qualificationRun.candidateCount} 支候选 · {qualificationRun.targetEntrantCount} 支正赛</p>
                  <p className="text-sm text-[var(--color-fg-mid)]">{qualificationRun.playInEntryCount} 支进入 Play-in · {qualificationRun.qualifierCount} 支晋级</p>
                  <p className="text-sm text-[var(--color-fg-mid)]">赛制：{qualificationRun.format === "direct_bo3" ? "BO3 决胜赛" : "Short Swiss · BO1 · 2胜晋级 / 2负淘汰"}</p>
                  <p className="text-sm font-medium text-[var(--color-fg)]">赛程待生成</p>
                </>
              ) : qualificationRun.completedAt ? (
                <>
                  <p className="font-medium text-[var(--color-fg)]">Play-in 已结束</p>
                  <p className="text-sm text-[var(--color-fg-mid)]">{qualificationRun.qualifierCount} 支队伍晋级</p>
                  <p className="text-sm text-[var(--color-fg-mid)]">正式正赛名单{finalMainEntrantsConfirmed ? "已确认" : "待确认"}</p>
                </>
              ) : (
                <>
                  <p className="font-medium text-[var(--color-fg)]">Play-in 进行中</p>
                  <p className="text-sm text-[var(--color-fg-mid)]">Round {qualificationCurrentRound}</p>
                  <p className="text-sm text-[var(--color-fg-mid)]">{qualificationRun.playInEntryCount} 支争夺 {qualificationRun.qualifierCount} 个正赛席位</p>
                </>
              )}
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/${seasonSlug}/matches?stage=play-in`}>查看 PLAY-IN 赛程 →</Link>
            </Button>
          </div>
        </Panel>
      )}

      {/* Upcoming matches and standings share a dual-column layout. */}
      {(upcomingMatches.length > 0 || standings.length > 0) && (
        <div className={upcomingMatches.length > 0 && standings.length > 0 ? "grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "grid grid-cols-1 gap-4"}>
          {/* Left: 近期比赛 */}
          {upcomingMatches.length > 0 && (
            <Panel
              label={
                <div className="flex items-center justify-between w-full">
                  <span>近期比赛</span>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/${seasonSlug}/matches`}>全部赛程 →</Link>
                  </Button>
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-2">
                {upcomingMatches.map((match) => (
                  <article key={match.id} className="min-w-0">
                    <div
                      className="flex items-center gap-2 p-2.5 rounded-sm transition-colors hover:bg-[var(--color-panel-hi)] hover:border-[var(--color-border-hi)]"
                      style={{
                        background: "var(--color-panel-low)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm font-semibold text-[var(--color-fg)] truncate flex-1 text-right">
                          <TeamProfileLink seasonSlug={seasonSlug} entryId={match.entryAId}>{match.teamAName ?? "待定"}</TeamProfileLink>
                        </span>
                        <span className="font-mono text-xs text-[var(--color-fg-dim)] shrink-0">vs</span>
                        <span className="text-sm font-semibold text-[var(--color-fg)] truncate flex-1">
                          <TeamProfileLink seasonSlug={seasonSlug} entryId={match.entryBId}>{match.teamBName ?? "待定"}</TeamProfileLink>
                        </span>
                      </div>
                      <Link href={`/${seasonSlug}/matches/${match.id}`} aria-label={`查看 ${match.teamAName ?? "待定"} 对 ${match.teamBName ?? "待定"} 比赛`} className="shrink-0 flex flex-col items-end gap-0.5">
                        <span className="font-mono text-xs text-[var(--color-fg-dim)] uppercase tracking-wider">
                          {(match.stage === null ? undefined : stageLabelByKey.get(match.stage)) ?? "比赛阶段"}
                        </span>
                        <MatchStatusBadge status={match.status as MatchStatus} scheduledAt={match.scheduledAt} />
                        {match.scheduledAt && <span className="font-mono text-xs text-[var(--color-fg-dim)]">{formatCSTDateTime(match.scheduledAt)}</span>}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
          )}

          {/* Right: 积分榜 TOP 4 */}
          {standings.length > 0 && (
            <Panel label="STANDINGS · TOP 4">
              <StandingsTable
                standings={standings.slice(0, 4)}
                seasonSlug={seasonSlug}
                isFinal={false}
              />
              <div className="mt-3">
                <Button variant="ghost" className="w-full" asChild>
                  <Link href={`/${seasonSlug}/matches`} className="w-full">
                    查看完整排名 →
                  </Link>
                </Button>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Stat 四格：只呈现可计数的赛事事实；阶段名称由真实 Stage 事实驱动。 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="TEAMS" value={publicTeamCount} />
        <Stat label="PLAYERS" value={publicPlayerCount} />
        <Stat
          label="MATCHES"
          value={(matchCountRow?.total ?? 0) > 0
            ? `${matchCountRow?.finished ?? 0}/${matchCountRow?.total ?? 0}`
            : "—"}
        />
        <Stat label="STAGE" value={stagePresentation.currentStageLabel ?? "—"} accent />
      </div>

      <SectionHeader title="继续探索" />

      <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href as never} className="group">
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] py-4 transition-colors group-hover:text-[var(--color-accent)]"><Icon size={18} className="text-[var(--color-fg-mid)]" /><h3 className="flex-1 text-sm font-medium">{label}</h3><span aria-hidden>↗</span></div>
          </Link>
        ))}
      </div>

      {(() => {
        const hasSeasonInfo = hasPublicSeasonInfo(seasonInfo);
        if (!latestSeasonAnnouncement && !hasSeasonInfo) return null;
        return (
          <div className={latestSeasonAnnouncement && hasSeasonInfo ? "grid gap-4 lg:grid-cols-2" : "grid grid-cols-1 gap-4"}>
            {latestSeasonAnnouncement && (
              <Panel label={<div className="flex w-full items-center justify-between gap-3"><span>最新公告</span><Button size="sm" variant="ghost" asChild><Link href={`/${seasonSlug}/announcements`}>历史公告 →</Link></Button></div>}>
                <p className="font-semibold text-[var(--color-fg)]">{latestSeasonAnnouncement.title}</p>
                <p className="mt-1 text-xs text-[var(--color-fg-dim)]">发布于 {new Date(latestSeasonAnnouncement.publishedAt).toLocaleString("zh-CN")}{latestSeasonAnnouncement.updatedAt !== latestSeasonAnnouncement.publishedAt && ` · 更新于 ${new Date(latestSeasonAnnouncement.updatedAt).toLocaleString("zh-CN")}`}</p>
                <p className="mt-1 line-clamp-3 text-sm text-[var(--color-fg-mid)]">{toAnnouncementExcerpt(latestSeasonAnnouncement.body)}</p>
              </Panel>
            )}
            {hasSeasonInfo && (
              <Panel label="赛事信息">
                {(() => {
                  const groupCount = activeGroupCount(seasonInfo);
                  const hasContacts = seasonInfo.contacts.length > 0;
                  const parts: ReactNode[] = [
                    <Link key="rules" href={`/${seasonSlug}/info`} className="text-[var(--color-accent)] hover:underline">
                      {seasonInfo.rules.label}
                    </Link>,
                  ];
                  if (groupCount > 0) {
                    parts.push(
                      <Link key="groups" href={`/${seasonSlug}/info`} className="text-[var(--color-accent)] hover:underline">
                        交流群（{groupCount} 个）
                      </Link>
                    );
                  }
                  if (hasContacts) {
                    parts.push(
                      <Link key="contacts" href={`/${seasonSlug}/info`} className="text-[var(--color-accent)] hover:underline">
                        联系方式
                      </Link>
                    );
                  }
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {parts.map((part, idx) => (
                        <Fragment key={idx}>
                          {idx > 0 && <span className="text-[var(--color-fg-dim)]">·</span>}
                          {part}
                        </Fragment>
                      ))}
                    </div>
                  );
                })()}
                <Link href={`/${seasonSlug}/info`} className="mt-3 inline-flex text-sm text-[var(--color-accent)] hover:underline">
                  查看完整赛事信息 →
                </Link>
              </Panel>
            )}
          </div>
        );
      })()}

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
