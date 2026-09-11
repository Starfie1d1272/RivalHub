import { publicCompetitionEntryCondition, publicCompetitionEntryLabel } from "@/lib/competition-entries/public-visibility";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { eq, count, or, and, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { UserPlus, Vote, Users, Swords, Shuffle, BarChart3, UserRoundSearch } from "lucide-react";
import { db } from "@/db/client";
import { matches, competitionEntries } from "@/db/schema";
import { formatCSTDateTime } from "@/lib/utils/date";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import type { SeasonStatus } from "@/types/season";
import { showStats } from "@/lib/utils/season";
import {
  isRegistrationActuallyOpen,
  presentRegistrationSchedule,
  presentSeasonParticipationState,
  presentSeasonStatus,
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
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const stageLabelByKey = new Map(
    stagePlan.map((stage) => [stage.key, presentStageMarker(stage, season.competitionTemplate)]),
  );
  const hasMatches = stagePlan.length > 0;

  // 查询已初始化的赛程阶段（有 match 记录的 stage）
  const matchStageRows = await db
    .selectDistinct({ stage: matches.stage })
    .from(matches)
    .where(eq(matches.seasonId, season.id));
  const initializedStages = new Set(matchStageRows.map((r) => r.stage));

  // ── 统计数据 + 即将到来的比赛 ────────────────────────────────────────
  const teamA = alias(competitionEntries, "team_a");
  const teamB = alias(competitionEntries, "team_b");

  const upcomingMatchesQuery = season.status === "playing"
    ? db
        .select({
          id: matches.id,
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
          and(
            eq(matches.seasonId, season.id),
            or(eq(matches.status, "scheduled"), eq(matches.status, "in_progress"))
          )
        )
        .orderBy(matches.scheduledAt)
        .limit(4)
    : null;

  const isMajor = season.competitionTemplate === "major";
  const [majorParticipantOverview, [teamCountRow], participantSummary, [matchCountRow], upcomingMatches, standings] =
    await Promise.all([
      isMajor ? getMajorPublicParticipantOverview(season) : Promise.resolve(null),
      isMajor
        ? Promise.resolve([] as { value: number }[])
        : db.select({ value: count() }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition())),
      isMajor ? Promise.resolve(null) : getParticipantSummary(season),
      db.select({
        total: count(),
        finished: sql<number>`count(*) filter (where ${matches.status} = 'finished')`,
      }).from(matches).where(eq(matches.seasonId, season.id)),
      upcomingMatchesQuery ?? Promise.resolve([] as { id: string; status: string; scheduledAt: Date | null; stage: string; teamAName: string | null; teamBName: string | null }[]),
      season.status === "playing" ? getStandings(season.id) : Promise.resolve([]),
    ]);
  const publicTeamCount = majorParticipantOverview?.teamCount ?? Number(teamCountRow?.value ?? 0);
  const publicPlayerCount = majorParticipantOverview?.playerCount ?? participantSummary?.count ?? 0;
  const publicTeamLabel = majorParticipantOverview?.presentation.teamCollectionLabel ?? publicCompetitionEntryLabel(season);

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
      done: currentStatusIdx > STATUS_IDX[rule.doneAfter],
    });
  }

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
  let currentPhaseIdx = phases.findIndex((p) => !p.done);
  if (currentPhaseIdx === -1) currentPhaseIdx = phases.length - 1;

  const isHistorical = season.status === "finished" || season.status === "archived";
  const registrationIsOpen = isRegistrationActuallyOpen(season);
  const registrationSchedule = presentRegistrationSchedule(season);
  const quickLinks = [
    {
      href: `/${seasonSlug}/register`,
      label: "立即报名",
      description: "提交报名信息",
      icon: UserPlus,
      show: !isHistorical && registrationIsOpen,
    },
    {
      href: `/${seasonSlug}/players`,
      label: "选手名单",
      description: majorParticipantOverview?.presentation.playerDescription ?? "已通过审核的参赛选手",
      icon: UserRoundSearch,
      show: true,
    },
    {
      href: `/${seasonSlug}/captains`,
      label: isHistorical ? "队长投票结果" : "队长投票",
      description: isHistorical ? "查看最终投票结果" : "为心仪队长投票",
      icon: Vote,
      show: season.hasCaptainVoting,
    },
    {
      href: `/${seasonSlug}/draft`,
      label: isHistorical ? "选秀回顾" : "选秀直播间",
      description: isHistorical ? "查看完整选人记录" : "实时观看选秀进度",
      icon: Shuffle,
      show: season.hasDraft,
    },
    {
      href: `/${seasonSlug}/teams`,
      label: "队伍阵容",
      description: "查看各队选手分布",
      icon: Users,
      show: true,
    },
    {
      href: `/${seasonSlug}/matches`,
      label: "赛程对决",
      description: "Bracket + 战报",
      icon: Swords,
      show: hasMatches,
    },
    {
      href: `/${seasonSlug}/stats`,
      label: "数据统计",
      description: "赛季排行榜与个人数据",
      icon: BarChart3,
      show: showStats(season),
    },
  ].filter((l) => l.show);

  return (
    <PageLayout variant="wide" className="space-y-8">
      <div className="relative mb-12 pt-6">
        <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-wider">
          <StatusPill {...presentSeasonParticipationState(season)} />
          <span className="text-[var(--color-fg-dim)]">{season.kind}</span>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--color-fg)] leading-tight">
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

      {(() => {
        const hasSeasonInfo = hasPublicSeasonInfo(seasonInfo);
        if (!latestSeasonAnnouncement && !hasSeasonInfo) return null;
        return (
          <div className={latestSeasonAnnouncement && hasSeasonInfo ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
            {latestSeasonAnnouncement && (
              <Panel label={<div className="flex w-full items-center justify-between gap-3"><span>最新公告</span><Button size="sm" variant="ghost" asChild><Link href={`/${seasonSlug}/announcements`}>历史公告 →</Link></Button></div>}>
                <p className="font-semibold text-[var(--color-fg)]">{latestSeasonAnnouncement.title}</p>
                <p className="mt-1 text-xs text-[var(--color-fg-dim)]">发布于 {new Date(latestSeasonAnnouncement.publishedAt).toLocaleString("zh-CN")}{latestSeasonAnnouncement.updatedAt !== latestSeasonAnnouncement.publishedAt && ` · 更新于 ${new Date(latestSeasonAnnouncement.updatedAt).toLocaleString("zh-CN")}`}</p>
                <p className="mt-1 line-clamp-3 text-sm text-[var(--color-fg-mid)]">{toAnnouncementExcerpt(latestSeasonAnnouncement.body)}</p>
              </Panel>
            )}
            {hasSeasonInfo && (
              <Panel label="赛事信息">
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link href={`/${seasonSlug}/info`} className="text-[var(--color-accent)] hover:underline">
                    {seasonInfo.rules.label}
                  </Link>
                  <span className="text-[var(--color-fg-dim)]">·</span>
                  <Link href={`/${seasonSlug}/info`} className="text-[var(--color-accent)] hover:underline">
                    交流群（{activeGroupCount(seasonInfo)} 个）
                  </Link>
                  <span className="text-[var(--color-fg-dim)]">·</span>
                  <Link href={`/${seasonSlug}/info`} className="text-[var(--color-accent)] hover:underline">
                    联系方式
                  </Link>
                </div>
                <Link href={`/${seasonSlug}/info`} className="mt-3 inline-flex text-sm text-[var(--color-accent)] hover:underline">
                  查看完整赛事信息 →
                </Link>
              </Panel>
            )}
          </div>
        );
      })()}

      {/* Phase tracker */}
      <Panel contentClassName="p-6">
        <ScrollHint fromColor="var(--color-panel)">
          <div className="flex items-start">
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

      {/* NEXT MATCHES + STANDINGS — dual column layout */}
      {(upcomingMatches.length > 0 || standings.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          {/* Left: 近期比赛 */}
          {upcomingMatches.length > 0 && (
            <Panel
              label={
                <div className="flex items-center justify-between w-full">
                  <span>NEXT MATCHES</span>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/${seasonSlug}/matches`}>VIEW ALL →</Link>
                  </Button>
                </div>
              }
            >
              <div className="grid gap-2">
                {upcomingMatches.map((match) => (
                  <Link key={match.id} href={`/${seasonSlug}/matches/${match.id}` as never}>
                    <div
                      className="flex items-center gap-2 p-2.5 rounded-sm transition-colors hover:bg-[var(--color-panel-hi)] hover:border-[var(--color-border-hi)]"
                      style={{
                        background: "var(--color-panel-low)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm font-semibold text-[var(--color-fg)] truncate flex-1 text-right">
                          {match.teamAName ?? "TBD"}
                        </span>
                        <span className="font-mono text-xs text-[var(--color-fg-dim)] shrink-0">vs</span>
                        <span className="text-sm font-semibold text-[var(--color-fg)] truncate flex-1">
                          {match.teamBName ?? "TBD"}
                        </span>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <span className="font-mono text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider">
                          {stageLabelByKey.get(match.stage) ?? "比赛阶段"}
                        </span>
                        {match.status === "in_progress" ? (
                          <span className="font-mono text-[10px] text-[var(--color-ok)]">● LIVE</span>
                        ) : match.scheduledAt ? (
                          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                            {formatCSTDateTime(match.scheduledAt)}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">待定</span>
                        )}
                      </div>
                    </div>
                  </Link>
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

      <SectionHeader title="赛季导航" description="快速访问各功能模块" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {quickLinks.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href as never} className="group">
            <Panel hoverable>
              <div className="flex flex-col gap-2">
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-sm mb-1 transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent-soft)",
                    color: "var(--color-accent)",
                  }}
                >
                  <Icon size={18} />
                </div>
                <h3 className="text-sm font-semibold text-[var(--color-fg)]">{label}</h3>
                <p className="text-xs text-[var(--color-fg-dim)]">{description}</p>
              </div>
            </Panel>
          </Link>
        ))}
      </div>

      {/* Stat 四格 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={publicTeamLabel} value={publicTeamCount} />
        <Stat label="选手" value={publicPlayerCount} />
        <Stat
          label="MATCHES"
          value={(matchCountRow?.total ?? 0) > 0
            ? `${matchCountRow?.finished ?? 0}/${matchCountRow?.total ?? 0}`
            : "—"}
        />
        <Stat label="STAGE" value={presentSeasonStatus(season.status).label} accent />
      </div>
    </PageLayout>
  );
}

function SeasonPageFallback() {
  return (
    <PageLayout variant="wide" className="min-h-[60vh]" aria-busy="true">
      <span className="sr-only">正在加载赛季首页…</span>
    </PageLayout>
  );
}