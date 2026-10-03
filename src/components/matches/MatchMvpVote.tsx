"use client";

import React, { useState, useEffect, useMemo, useOptimistic, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Panel } from "@/components/rivalhub";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { castMatchMvpVote } from "@/actions/player-stats";
import { MVP_DEADLINE_MS } from "@/lib/utils/date";
import { formatStat, type StatMetric } from "@/lib/stats";
import { useRoutePolling } from "@/components/use-visible-polling";
import { StatsMetricHelp } from "@/components/stats/StatsMetricHelp";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { MetricValue } from "@/components/stats/MetricValue";
import { STATS_METRICS } from "@/lib/stats/metrics";
import type { StatsRateValue } from "@/lib/stats/presentation";
import { Button } from "@/components/ui/button";

interface MvpCandidate {
  userId: string | null;
  avatarUrl: string | null;
  perfectName: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  hsPercent: number | null;
  firstKills: number | null;
  multiKills: number | null;
  clutches: number | null;
  adr: number | null;
  rws: number | null;
  ratingPro: number | null;
  we: number | null;
}

export interface MvpPerformance {
  playerId: string;
  rounds: number;
  kast: StatsRateValue;
  trade: StatsRateValue;
  utility: StatsRateValue;
  flashAssist: StatsRateValue;
}

interface MatchMvpVoteProps {
  matchId: string;
  candidates: MvpCandidate[];
  currentVotes: { playerUserId: string | null; playerName: string; count: number }[];
  userVotedPlayerName: string | null;
  completedAt: string | null;
  winnerUserId: string | null;
  winnerPerformance?: MvpPerformance | null;
  winnerDetailsHref?: string;
}

const candidateKey = (userId: string | null, name: string) => userId ?? `legacy:${name}`;
const RESULT_REFRESH_WINDOW_MS = 15 * 60_000;

export function MatchMvpVote({
  matchId,
  candidates,
  currentVotes,
  userVotedPlayerName,
  completedAt,
  winnerUserId,
  winnerPerformance,
  winnerDetailsHref,
}: MatchMvpVoteProps) {
  const [optimisticVotes, addOptimisticVote] = useOptimistic(
    currentVotes,
    (votes, candidate: { playerUserId: string; playerName: string }) => {
      const existing = votes.some((vote) => vote.playerUserId === candidate.playerUserId);
      return existing
        ? votes.map((vote) => vote.playerUserId === candidate.playerUserId ? { ...vote, count: vote.count + 1 } : vote)
        : [...votes, { ...candidate, count: 1 }];
    },
  );
  const [votedName, setVotedName] = useState(userVotedPlayerName);
  const [now, setNow] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  const deadline = useMemo(
    () => (completedAt ? new Date(new Date(completedAt).getTime() + MVP_DEADLINE_MS) : null),
    [completedAt],
  );
  const votingClosed = winnerUserId !== null || (deadline ? now >= deadline.getTime() : false);
  // Allow several scheduler runs without polling no-vote or historical matches
  // indefinitely. Zero initial votes may still be a stale pre-cutoff snapshot.
  const withinResultRefreshWindow = deadline !== null && now < deadline.getTime() + RESULT_REFRESH_WINDOW_MS;
  const { refresh, refreshPending } = useRoutePolling(
    votingClosed && !winnerUserId && withinResultRefreshWindow ? 60_000 : null,
    isPending,
  );
  const timeLeft = deadline && !votingClosed
    ? Math.max(0, deadline.getTime() - now)
    : 0;
  const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
  const minsLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

  // Keep the local clock through the bounded settlement window; returning from
  // a suspended tab updates both the cutoff display and the polling lifetime.
  useEffect(() => {
    if (!deadline || winnerUserId || !withinResultRefreshWindow) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline, winnerUserId, withinResultRefreshWindow]);

  async function handleVote(playerUserId: string | null, playerName: string) {
    if (!playerUserId || votedName || votingClosed) return;
    startTransition(async () => {
      addOptimisticVote({ playerUserId, playerName });
      const result = await castMatchMvpVote(matchId, playerUserId);
      if (result.success) {
        setVotedName(playerName);
      }
    });
  }

  const allVotes = [...optimisticVotes];
  for (const c of candidates) {
    if (!allVotes.find((v) => candidateKey(v.playerUserId, v.playerName) === candidateKey(c.userId, c.perfectName))) {
      allVotes.push({ playerUserId: c.userId, playerName: c.perfectName, count: 0 });
    }
  }
  const mvp = winnerUserId ? allVotes.find((vote) => vote.playerUserId === winnerUserId) : undefined;
  const awaitingSettlement = votingClosed && !winnerUserId && allVotes.some((vote) => vote.playerUserId && vote.count > 0);
  const maxVoteCount = Math.max(0, ...allVotes.map((v) => v.count));
  const mvpStats = mvp ? candidates.find((c) => c.userId === mvp.playerUserId) : undefined;

  // ── 投票截止：展示 MVP 结果 ──
  if (votingClosed) {
    return (
      <Panel contentClassName="space-y-5 p-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-[var(--color-fg-mid)]">{awaitingSettlement ? "MVP 结果确认中" : "本场 MVP"}</p>
          <div className="flex items-center justify-center gap-2 text-xl font-bold text-[var(--color-accent)]">
            {mvpStats && <PlayerAvatar name={mvp?.playerName ?? "MVP"} avatarUrl={mvpStats.avatarUrl} size="md" />}
            {mvp?.playerUserId ? (
              <Link href={`/players/${mvp.playerUserId}`} className="hover:underline">
                {mvp?.playerName ?? (awaitingSettlement ? "等待结果确认" : "暂无 MVP 结果")}
              </Link>
            ) : (
              mvp?.playerName ?? (awaitingSettlement ? "等待结果确认" : "暂无 MVP 结果")
            )}
          </div>
          <p className="text-sm text-[var(--color-fg-mid)]">
            {mvp ? mvp.count > 0 ? `${mvp.count} 票` : "已确认" : "投票已截止"}
          </p>
          {!winnerUserId && (
            <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshPending}>
              刷新 MVP 结果
            </Button>
          )}
        </div>

        {mvpStats && <dl className="grid grid-cols-3 divide-x divide-[var(--color-border)] border-y border-[var(--color-border)] py-4 text-center">
          <div><dt className="text-xs text-[var(--color-fg-dim)]"><MvpMetricLabel help={<StatsMetricHelp metric="rating" />}>Rating</MvpMetricLabel></dt><dd className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--color-accent)]">{formatStat("ratingPro", mvpStats.ratingPro)}</dd></div>
          <div><dt className="text-xs text-[var(--color-fg-dim)]"><MvpMetricLabel help={<HelpTooltip label="K / D / A 指标说明" content="依次为本场击杀、死亡和助攻总数。" />}>K / D / A</MvpMetricLabel></dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{mvpStats.kills ?? "—"} / {mvpStats.deaths ?? "—"} / {mvpStats.assists ?? "—"}</dd></div>
          <div><dt className="text-xs text-[var(--color-fg-dim)]"><MvpMetricLabel help={<StatsMetricHelp metric="adr" />}>ADR</MvpMetricLabel></dt><dd className="mt-1 font-mono text-2xl font-bold tabular-nums">{formatStat("adr", mvpStats.adr)}</dd></div>
        </dl>}

        {mvpStats && <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-center text-sm sm:grid-cols-6" aria-label="MVP 关键表现">
          <StatCell label="HS%" value={mvpStats.hsPercent} metric="hsPercent" help={STATS_METRICS.hs.description} />
          <StatCell label="FK" value={mvpStats.firstKills} metric="firstKills" help={"本场取得首杀的总次数。"} />
          <StatCell label="MK" value={mvpStats.multiKills} metric="multiKills" help={"本场取得至少双杀的回合数。"} />
          <StatCell label="CL" value={mvpStats.clutches} metric="clutches" help={STATS_METRICS.clutchWins.description} />
          <StatCell label="RWS" value={mvpStats.rws} metric="rws" help={STATS_METRICS.rws.description} />
          <StatCell label="WE" value={mvpStats.we} metric="we" help={STATS_METRICS.we.description} />
        </div>}
        {mvpStats && winnerPerformance?.playerId === winnerUserId && <div className="space-y-3 border-t border-[var(--color-border)] pt-4" aria-label="MVP 进阶表现">
          <p className="text-xs text-[var(--color-fg-dim)]">Advanced · {winnerPerformance.rounds} rounds</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-center sm:grid-cols-4">
            {(["kast", "trade", "utility", "flashAssist"] as const).map(metric => <div key={metric}>
              <dt className="text-xs text-[var(--color-fg-dim)]"><MvpMetricLabel help={<StatsMetricHelp metric={metric} />}>{STATS_METRICS[metric].label}</MvpMetricLabel></dt>
              <dd className="mt-1 flex justify-center font-mono text-lg font-semibold"><MetricValue metric={metric} value={winnerPerformance[metric]} sampleDisplay="hidden" /></dd>
            </div>)}
          </dl>
        </div>}
        {mvpStats && winnerDetailsHref && <div className="text-center"><Link href={winnerDetailsHref as Route} className="text-sm text-[var(--color-accent)] hover:underline">完整数据 →</Link></div>}

        {allVotes.filter((v) => v !== mvp).length > 0 && (
          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-[var(--color-fg-dim)] sm:col-span-2 lg:col-span-4">其他候选人</p>
            {allVotes
              .filter((v) => v !== mvp)
              .sort((a, b) => b.count - a.count)
              .map((v) => (
                <div key={candidateKey(v.playerUserId, v.playerName)} className="flex min-w-0 items-center justify-between gap-3 border border-[var(--color-border)] p-3 text-[var(--color-fg-mid)]">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    {(() => {
                      const candidate = candidates.find((c) => candidateKey(c.userId, c.perfectName) === candidateKey(v.playerUserId, v.playerName));
                      return candidate ? <PlayerAvatar name={v.playerName} avatarUrl={candidate.avatarUrl} size="sm" /> : null;
                    })()}
                    {v.playerUserId ? (
                      <Link href={`/players/${v.playerUserId}`} className="truncate hover:text-[var(--color-accent)] transition-colors">
                        {v.playerName}
                      </Link>
                    ) : (
                      v.playerName
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{v.count} 票</span>
                </div>
              ))}
          </div>
        )}
      </Panel>
    );
  }

  // ── 投票中 ──
  function cardStyle(isVoted: boolean, hasVoted: boolean): string {
    const base = "rounded-sm p-4 text-left transition-colors";
    if (isVoted) return `${base} bg-[var(--color-accent-soft)] ring-1 ring-inset ring-[var(--color-accent)]`;
    if (hasVoted) return `${base} bg-[var(--color-panel-hi)] cursor-not-allowed opacity-60`;
    return `${base} bg-[var(--color-panel-hi)] hover:bg-[var(--color-panel)] cursor-pointer`;
  }

  return (
    <Panel contentClassName="space-y-4 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-[var(--color-fg)]">
          本场 MVP 投票
        </h3>
        <span className="text-xs text-[var(--color-fg-mid)]">
          剩余 {hoursLeft}h {minsLeft}m
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {candidates.map((c) => {
          const v = optimisticVotes.find((x) => candidateKey(x.playerUserId, x.playerName) === candidateKey(c.userId, c.perfectName));
          const count = v?.count ?? 0;
          const isVoted = votedName === c.perfectName;
          const isLeading = count === maxVoteCount && count > 0;

          return (
            <button
              key={candidateKey(c.userId, c.perfectName)}
              disabled={!c.userId || !!votedName || isPending}
              onClick={() => handleVote(c.userId, c.perfectName)}
              className={[
                cardStyle(isVoted, !!votedName),
                isLeading && !isVoted ? "border border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "",
              ].join(" ").trim()}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-[var(--color-fg)]">
                  <PlayerAvatar name={c.perfectName} avatarUrl={c.avatarUrl} size="sm" />
                  {c.perfectName}
                </span>
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{
                    color: c.ratingPro != null && c.ratingPro >= 1.2
                      ? "var(--color-accent)"
                      : "var(--color-fg)",
                  }}
                >
                  {formatStat("ratingPro", c.ratingPro)}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1 text-center text-xs mb-2">
                <StatCell label="K" value={c.kills} metric="kills" />
                <StatCell label="D" value={c.deaths} metric="deaths" />
                <StatCell label="A" value={c.assists} metric="assists" />
                <StatCell label="ADR" value={c.adr} metric="adr" />
                <StatCell label="RWS" value={c.rws} metric="rws" />
              </div>

              <div className="grid grid-cols-4 gap-1 text-center text-[11px] mb-2">
                <StatCell label="HS%" value={c.hsPercent} metric="hsPercent" />
                <StatCell label="FK" value={c.firstKills} metric="firstKills" />
                <StatCell label="MK" value={c.multiKills} metric="multiKills" />
                <StatCell label="CL" value={c.clutches} metric="clutches" />
              </div>

              <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2">
                <span className={`text-xs font-semibold tabular-nums ${isVoted ? "text-[var(--color-accent)]" : "text-[var(--color-fg-mid)]"}`}>
                  {count} 票
                </span>
                {isVoted && <span className="text-xs text-[var(--color-accent)]">已投票</span>}
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function StatCell({
  label,
  value,
  metric,
  help,
}: {
  label: string;
  value: number | null;
  metric: StatMetric;
  help?: string;
}) {
  return (
    <div>
      <span className="text-[var(--color-fg-dim)]"><MvpMetricLabel help={help ? <HelpTooltip label={`${label} 指标说明`} content={help} /> : undefined}>{label}</MvpMetricLabel></span>
      <span className="tabular-nums block text-[var(--color-fg)]">
        {formatStat(metric, value)}
      </span>
    </div>
  );
}

/** Help sits beside the label without shifting its alignment with the value. */
function MvpMetricLabel({ children, help }: { children: React.ReactNode; help?: React.ReactNode }) {
  return <span className="relative inline-block">{children}{help && <span className="absolute left-full top-1/2 ml-1 -translate-y-1/2 leading-none">{help}</span>}</span>;
}
