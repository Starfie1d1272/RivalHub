"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { castMatchMvpVote } from "@/actions/player-stats";
import { isDeadlinePassed, MVP_DEADLINE_MS } from "@/lib/utils/date";
import { formatStat, type StatMetric } from "@/lib/stats";

interface MvpCandidate {
  userId: string | null;
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

interface MatchMvpVoteProps {
  matchId: string;
  candidates: MvpCandidate[];
  currentVotes: { playerUserId: string | null; playerName: string; count: number }[];
  userVotedPlayerName: string | null;
  completedAt: string | null;
}

export function MatchMvpVote({
  matchId,
  candidates,
  currentVotes,
  userVotedPlayerName,
  completedAt,
}: MatchMvpVoteProps) {
  const [optimisticVotes, setOptimisticVotes] = useState(currentVotes);
  const [votedName, setVotedName] = useState(userVotedPlayerName);
  const [now, setNow] = useState(Date.now());
  const [isPending, startTransition] = useTransition();

  const deadline = useMemo(
    () => (completedAt ? new Date(new Date(completedAt).getTime() + MVP_DEADLINE_MS) : null),
    [completedAt],
  );
  const votingClosed = deadline ? isDeadlinePassed(deadline) : false;
  const timeLeft = deadline && !votingClosed
    ? Math.max(0, deadline.getTime() - now)
    : 0;
  const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
  const minsLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));

  // 每 30s 刷新倒计时；截止时切到结果视图
  useEffect(() => {
    if (!deadline || votingClosed) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, [deadline, votingClosed]);

  async function handleVote(playerUserId: string | null, playerName: string) {
    if (!playerUserId || votedName || votingClosed) return;
    startTransition(async () => {
      const result = await castMatchMvpVote(matchId, playerUserId);
      if (result.success) {
        setVotedName(playerName);
        setOptimisticVotes((prev) =>
          prev.map((v) =>
            v.playerName === playerName ? { ...v, count: v.count + 1 } : v,
          ),
        );
      }
    });
  }

  const allVotes = [...optimisticVotes];
  for (const c of candidates) {
    if (!allVotes.find((v) => v.playerName === c.perfectName)) {
      allVotes.push({ playerUserId: c.userId, playerName: c.perfectName, count: 0 });
    }
  }
  const mvp = allVotes.reduce((a, b) => (a.count >= b.count ? a : b), allVotes[0]);
  const maxVoteCount = Math.max(...allVotes.map((v) => v.count));
  const mvpStats = candidates.find((c) => c.perfectName === mvp?.playerName);

  // ── 投票截止：展示 MVP 结果 ──
  if (votingClosed) {
    return (
      <Panel contentClassName="space-y-5 p-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-[var(--color-fg-mid)]">本场 MVP</p>
          <p className="text-2xl font-bold text-[var(--color-accent)]">
            {mvp?.playerUserId ? (
              <Link href={`/players/${mvp.playerUserId}`} className="hover:underline">
                {mvp?.playerName ?? "—"}
              </Link>
            ) : (
              mvp?.playerName ?? "—"
            )}
          </p>
          <p className="text-sm text-[var(--color-fg-mid)]">
            {mvp?.count ?? 0} 票
          </p>
        </div>

        {mvpStats && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {STAT_COLS.map((c) => (
                    <th key={c.key} className="pb-1 text-[10px] text-[var(--color-fg-dim)] font-normal text-center">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[var(--color-border)]">
                  {STAT_COLS.map((c) => {
                    const v = mvpStats[c.key];
                    return (
                      <td key={c.key} className="py-1.5 tabular-nums text-center text-[var(--color-fg)]">
                        {formatStat(c.metric, v)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {allVotes.filter((v) => v.playerName !== mvp?.playerName).length > 0 && (
          <div className="text-xs space-y-1">
            <p className="text-[var(--color-fg-dim)]">其他候选人</p>
            {allVotes
              .filter((v) => v.playerName !== mvp?.playerName)
              .sort((a, b) => b.count - a.count)
              .map((v) => (
                <div key={v.playerName} className="flex justify-between text-[var(--color-fg-mid)]">
                  <span>
                    {v.playerUserId ? (
                      <Link href={`/players/${v.playerUserId}`} className="hover:text-[var(--color-accent)] transition-colors">
                        {v.playerName}
                      </Link>
                    ) : (
                      v.playerName
                    )}
                  </span>
                  <span className="tabular-nums">{v.count} 票</span>
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
          const v = optimisticVotes.find((x) => x.playerName === c.perfectName);
          const count = v?.count ?? 0;
          const isVoted = votedName === c.perfectName;
          const isLeading = count === maxVoteCount && count > 0;

          return (
            <button
              key={c.perfectName}
              disabled={!c.userId || !!votedName || isPending}
              onClick={() => handleVote(c.userId, c.perfectName)}
              className={[
                cardStyle(isVoted, !!votedName),
                isLeading && !isVoted ? "border border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "",
              ].join(" ").trim()}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-[var(--color-fg)]">
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
                <StatCell label="残局" value={c.clutches} metric="clutches" />
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
}: {
  label: string;
  value: number | null;
  metric: StatMetric;
}) {
  return (
    <div>
      <span className="text-[var(--color-fg-dim)]">{label}</span>
      <span className="tabular-nums block text-[var(--color-fg)]">
        {formatStat(metric, value)}
      </span>
    </div>
  );
}

const STAT_COLS = [
  { key: "kills" as const,      label: "K",      metric: "kills" },
  { key: "deaths" as const,     label: "D",      metric: "deaths" },
  { key: "assists" as const,    label: "A",      metric: "assists" },
  { key: "hsPercent" as const,  label: "HS%",    metric: "hsPercent" },
  { key: "firstKills" as const, label: "FK",     metric: "firstKills" },
  { key: "multiKills" as const, label: "MK",     metric: "multiKills" },
  { key: "clutches" as const,   label: "残局",   metric: "clutches" },
  { key: "adr" as const,        label: "ADR",    metric: "adr" },
  { key: "rws" as const,        label: "RWS",    metric: "rws" },
  { key: "ratingPro" as const,  label: "Rating", metric: "ratingPro" },
] as const satisfies readonly { key: keyof MvpCandidate; label: string; metric: StatMetric }[];
