"use client";

import { useState, useEffect, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { castMatchMvpVote } from "@/actions/player-stats";
import { isDeadlinePassed, MVP_DEADLINE_MS } from "@/lib/utils/date";

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

  const deadline = completedAt
    ? new Date(new Date(completedAt).getTime() + MVP_DEADLINE_MS)
    : null;
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
    if (votedName || votingClosed) return;
    startTransition(async () => {
      const result = await castMatchMvpVote(matchId, playerUserId, playerName);
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
  const mvpStats = candidates.find((c) => c.perfectName === mvp?.playerName);

  // ── 投票截止：展示 MVP 结果 ──
  if (votingClosed) {
    return (
      <Card className="p-6 space-y-5 border-[var(--color-border)]">
        <div className="text-center space-y-1">
          <p className="text-sm text-[var(--color-fg-mid)]">本场 MVP</p>
          <p className="text-2xl font-bold text-[var(--color-accent)]">
            {mvp?.playerName ?? "—"}
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
                    const val = v != null ? (c.fmt ? c.fmt(v as never) : String(v)) : "—";
                    return (
                      <td key={c.key} className="py-1.5 tabular-nums text-center text-[var(--color-fg)]">
                        {val}
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
                  <span>{v.playerName}</span>
                  <span className="tabular-nums">{v.count} 票</span>
                </div>
              ))}
          </div>
        )}
      </Card>
    );
  }

  // ── 投票中 ──
  function cardStyle(isVoted: boolean, hasVoted: boolean): string {
    const base = "rounded-lg p-4 text-left transition-colors";
    if (isVoted) return `${base} bg-[rgba(255,107,26,0.12)] ring-1 ring-inset ring-[var(--color-accent)]`;
    if (hasVoted) return `${base} bg-[var(--color-panel-hi)] cursor-not-allowed opacity-60`;
    return `${base} bg-[var(--color-panel-hi)] hover:bg-[var(--color-panel)] cursor-pointer`;
  }

  return (
    <Card className="p-5 space-y-4 border-[var(--color-border)]">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-[var(--color-fg)]">
          本场 MVP 投票
        </h3>
        <span className="text-xs text-[var(--color-fg-mid)]">
          剩余 {hoursLeft}h {minsLeft}m
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {candidates.map((c) => {
          const v = optimisticVotes.find((x) => x.playerName === c.perfectName);
          const count = v?.count ?? 0;
          const isVoted = votedName === c.perfectName;

          return (
            <button
              key={c.perfectName}
              disabled={!!votedName || isPending}
              onClick={() => handleVote(c.userId, c.perfectName)}
              className={cardStyle(isVoted, !!votedName)}
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
                  {c.ratingPro != null ? c.ratingPro.toFixed(2) : "—"}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1 text-center text-xs mb-2">
                <StatCell label="K" value={c.kills} />
                <StatCell label="D" value={c.deaths} />
                <StatCell label="A" value={c.assists} />
                <StatCell label="ADR" value={c.adr} fmt={(v) => v.toFixed(1)} />
                <StatCell label="RWS" value={c.rws} fmt={(v) => v.toFixed(1)} />
              </div>

              <div className="grid grid-cols-4 gap-1 text-center text-[11px] mb-2">
                <StatCell label="HS%" value={c.hsPercent} fmt={(v) => `${v}%`} />
                <StatCell label="FK" value={c.firstKills} />
                <StatCell label="MK" value={c.multiKills} />
                <StatCell label="残局" value={c.clutches} />
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
    </Card>
  );
}

function StatCell({
  label,
  value,
  fmt,
}: {
  label: string;
  value: number | null;
  fmt?: (v: number) => string;
}) {
  return (
    <div>
      <span className="text-[var(--color-fg-dim)]">{label}</span>
      <span className="tabular-nums block text-[var(--color-fg)]">
        {value != null ? (fmt ? fmt(value) : String(value)) : "—"}
      </span>
    </div>
  );
}

const STAT_COLS = [
  { key: "kills" as const,     label: "K",    fmt: undefined as ((v: number) => string) | undefined },
  { key: "deaths" as const,    label: "D",    fmt: undefined },
  { key: "assists" as const,   label: "A",    fmt: undefined },
  { key: "hsPercent" as const, label: "HS%",  fmt: (v: number) => `${v}%` },
  { key: "firstKills" as const,label: "FK",   fmt: undefined },
  { key: "multiKills" as const,label: "MK",   fmt: undefined },
  { key: "clutches" as const,  label: "残局", fmt: undefined },
  { key: "adr" as const,       label: "ADR",  fmt: (v: number) => v.toFixed(1) },
  { key: "rws" as const,       label: "RWS",  fmt: (v: number) => v.toFixed(1) },
  { key: "ratingPro" as const, label: "Rating", fmt: (v: number) => v.toFixed(2) },
];
