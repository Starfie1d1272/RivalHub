import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, count, or, and, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { UserPlus, Vote, Users, Swords, Shuffle, BarChart3, UserRoundSearch } from "lucide-react";
import { db } from "@/db/client";
import { seasons, matches, teams, seasonRegistrations } from "@/db/schema";
import { formatCSTShortDate } from "@/lib/utils/date";
import { normalizeStagePlan } from "@/types/season";
import type { SeasonStatus } from "@/types/season";
import { showStats } from "@/lib/utils/season";
import { StatusPill, Panel, Marker, ScrollHint, Stat, PhaseStep, Btn } from "@/components/rivalhub";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminShortcut } from "@/components/layout/AdminShortcut";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { getStandings } from "@/lib/data/standings";

const STATUS_IDX: Record<SeasonStatus, number> = {
  draft: 0, registration: 1, voting: 2, drafting: 3,
  playing: 4, finished: 5, archived: 6,
};

interface SeasonPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonPage({ params }: SeasonPageProps) {
  const { seasonSlug } = await params;

  const [season, adminSession] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    checkAdminSession(),
  ]);
  if (!season) notFound();
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const hasMatches = stagePlan.length > 0;

  // 查询已初始化的赛程阶段（有 match 记录的 stage）
  const matchStageRows = await db
    .selectDistinct({ stage: matches.stage })
    .from(matches)
    .where(eq(matches.seasonId, season.id));
  const initializedStages = new Set(matchStageRows.map((r) => r.stage));

  // ── 统计数据 + 即将到来的比赛 ────────────────────────────────────────
  const teamA = alias(teams, "team_a");
  const teamB = alias(teams, "team_b");

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
        .leftJoin(teamA, eq(matches.teamAId, teamA.id))
        .leftJoin(teamB, eq(matches.teamBId, teamB.id))
        .where(
          and(
            eq(matches.seasonId, season.id),
            or(eq(matches.status, "scheduled"), eq(matches.status, "in_progress"))
          )
        )
        .orderBy(matches.scheduledAt)
        .limit(4)
    : null;

  const [[teamCountRow], [approvedCountRow], [matchCountRow], upcomingMatches, standings] =
    await Promise.all([
      db.select({ value: count() }).from(teams).where(eq(teams.seasonId, season.id)),
      db.select({ value: count() }).from(seasonRegistrations).where(
        and(eq(seasonRegistrations.seasonId, season.id), eq(seasonRegistrations.status, "approved"))
      ),
      db.select({
        total: count(),
        finished: sql<number>`count(*) filter (where ${matches.status} = 'finished')`,
      }).from(matches).where(eq(matches.seasonId, season.id)),
      upcomingMatchesQuery ?? Promise.resolve([] as { id: string; status: string; scheduledAt: Date | null; stage: string; teamAName: string | null; teamBName: string | null }[]),
      season.status === "playing" ? getStandings(season.id) : Promise.resolve([]),
    ]);

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
        label: stage.key.toUpperCase(),
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

  const quickLinks = [
    {
      href: `/${seasonSlug}/register`,
      label: "立即报名",
      description: "提交报名信息",
      icon: UserPlus,
      show: true,
    },
    {
      href: `/${seasonSlug}/players`,
      label: "选手名单",
      description: "已通过审核的参赛选手",
      icon: UserRoundSearch,
      show: true,
    },
    {
      href: `/${seasonSlug}/captains`,
      label: "队长投票",
      description: "为心仪队长投票",
      icon: Vote,
      show: season.hasCaptainVoting,
    },
    {
      href: `/${seasonSlug}/draft`,
      label: "选秀直播间",
      description: "实时观看选秀进度",
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
    <div className="container mx-auto px-4 py-10">
      <div className="relative mb-12 pt-6">
        <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-wider">
          <StatusPill status={season.status} />
          <span className="text-[var(--color-fg-dim)]">{season.kind}</span>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--color-fg)] leading-tight">
            {season.name}
          </h1>
          {adminSession && (
            <AdminShortcut href={`/admin/${seasonSlug}/settings`} />
          )}
        </div>
      </div>

      {/* Phase tracker */}
      <Panel pad={24}>
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
                  <Btn small ghost asChild>
                    <Link href={`/${seasonSlug}/matches`}>VIEW ALL →</Link>
                  </Btn>
                </div>
              }
            >
              <div className="grid gap-2">
                {upcomingMatches.map((match) => (
                  <Link key={match.id} href={`/${seasonSlug}/matches/${match.id}` as never}>
                    <div
                      className="flex items-center gap-2.5 p-2.5 rounded-sm transition-colors hover:bg-[var(--color-panel-hi)] hover:border-[var(--color-border-hi)]"
                      style={{
                        background: "var(--color-panel-low)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div className="flex items-center gap-8">
                        <div className="min-w-0 flex-1 flex items-center justify-end gap-2">
                          <span className="text-sm font-semibold text-[var(--color-fg)] truncate">
                            {match.teamAName ?? "TBD"}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-[var(--color-fg-dim)] shrink-0">vs</span>
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--color-fg)] truncate">
                            {match.teamBName ?? "TBD"}
                          </span>
                        </div>
                        <div className="shrink-0">
                          {match.status === "in_progress" ? (
                            <span className="font-mono text-[11px] text-[var(--color-ok)]">● LIVE</span>
                          ) : match.scheduledAt ? (
                            <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">
                              {formatCSTShortDate(match.scheduledAt)}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">待定</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 font-mono text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider">
                        {match.stage}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {/* Right: 积分榜 TOP 4 */}
          {standings.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3
                  className="font-semibold text-sm"
                  style={{
                    fontFamily: "var(--font-sans)",
                    color: "var(--color-fg)",
                  }}
                >
                  STANDINGS · TOP 4
                </h3>
              </div>
              <StandingsTable
                standings={standings.slice(0, 4)}
                seasonSlug={seasonSlug}
                isFinal={false}
              />
              <div className="mt-3">
                <Btn full ghost asChild>
                  <Link href={`/${seasonSlug}/matches`} className="w-full">
                    查看完整排名 →
                  </Link>
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <Marker sub="快速访问各功能模块">赛季导航</Marker>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {quickLinks.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href as never} className="group">
            <Panel hoverable>
              <div className="flex flex-col gap-2">
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-md mb-1 transition-colors"
                  style={{
                    backgroundColor: `rgba(255, 107, 26, 0.1)`,
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
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="TEAMS" value={teamCountRow?.value ?? 0} />
        <Stat label="PLAYERS" value={approvedCountRow?.value ?? 0} />
        <Stat
          label="MATCHES"
          value={(matchCountRow?.total ?? 0) > 0
            ? `${matchCountRow?.finished ?? 0}/${matchCountRow?.total ?? 0}`
            : "—"}
        />
        <Stat label="STAGE" value={season.status.toUpperCase()} accent />
      </div>
    </div>
  );
}
