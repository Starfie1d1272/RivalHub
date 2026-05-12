"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { castMatchMvpVote } from "@/actions/player-stats";

interface MvpCandidate {
  userId: string | null;
  perfectName: string;
  ratingPro: number | null;
}

interface MatchMvpVoteProps {
  matchId: string;
  candidates: MvpCandidate[];
  currentVotes: { playerUserId: string | null; playerName: string; count: number }[];
  userVotedPlayerName: string | null;
}

export function MatchMvpVote({
  matchId,
  candidates,
  currentVotes,
  userVotedPlayerName,
}: MatchMvpVoteProps) {
  const [optimisticVotes, setOptimisticVotes] = useState(currentVotes);
  const [votedName, setVotedName] = useState(userVotedPlayerName);
  const [isPending, startTransition] = useTransition();

  async function handleVote(playerUserId: string | null, playerName: string) {
    if (votedName) return;
    startTransition(async () => {
      const result = await castMatchMvpVote(matchId, playerUserId, playerName);
      if (result.success) {
        setVotedName(playerName);
        setOptimisticVotes((prev) =>
          prev.map((v) =>
            v.playerName === playerName
              ? { ...v, count: v.count + 1 }
              : v
          )
        );
      }
    });
  }

  const leading = optimisticVotes.length > 0
    ? optimisticVotes.reduce((a, b) => (a.count > b.count ? a : b))
    : null;

  const sorted = [...candidates].sort(
    (a, b) => (b.ratingPro ?? 0) - (a.ratingPro ?? 0)
  );

  return (
    <Card className="p-5 space-y-4 border-[var(--color-border)]">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--color-fg)]">
          本场 MVP 投票
        </h3>
        {votedName && (
          <span className="text-xs text-[var(--color-fg-mid)]">
            你已投票: <span className="text-[var(--primary)]">{votedName}</span>
          </span>
        )}
        {leading && (
          <span className="text-xs text-[var(--color-fg-mid)]">
            当前领先:{" "}
            <span className="text-[var(--color-accent)] font-semibold">
              {leading.playerName} ({leading.count} 票)
            </span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        {sorted.map((c) => {
          const v = optimisticVotes.find(
            (x) => x.playerName === c.perfectName
          );
          const count = v?.count ?? 0;
          const isVoted = votedName === c.perfectName;

          return (
            <button
              key={c.perfectName}
              disabled={!!votedName || isPending}
              onClick={() => handleVote(c.userId, c.perfectName)}
              className={`flex items-center justify-between rounded-md p-2.5 text-left transition-colors ${
                isVoted
                  ? "bg-[rgba(255, 107, 26,0.12)] ring-1 ring-inset ring-[var(--color-accent)]"
                  : votedName
                  ? "bg-[var(--color-panel-hi)] cursor-not-allowed"
                  : "bg-[var(--color-panel-hi)] hover:bg-[var(--color-panel)] cursor-pointer"
              }`}
            >
              <span className="text-[var(--color-fg)]">
                {c.perfectName}
                <span className="text-[11px] text-[var(--color-fg-dim)] ml-1.5">
                  ({c.ratingPro?.toFixed(2) ?? "—"})
                </span>
              </span>
              <span
                className={`tabular-nums text-xs font-semibold ${
                  isVoted ? "text-[var(--color-accent)]" : "text-[var(--color-fg-mid)]"
                }`}
              >
                {count} 票
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
