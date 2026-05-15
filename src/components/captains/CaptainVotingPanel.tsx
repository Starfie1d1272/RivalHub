"use client";

import { useEffect, useTransition } from "react";
import { RefreshCw, Undo2, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { castVote, retractVote } from "@/actions/captains";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createBrowserClient } from "@/lib/auth/supabase";
import { MAX_CAPTAIN_VOTES } from "@/lib/captains/rules";
import { POSITION_LABELS } from "@/lib/validators/registration";
import type {
  CaptainCandidateRow,
  CaptainVoteRecord,
  CaptainVoterOption,
} from "@/lib/captains/data";

interface CaptainVotingPanelProps {
  seasonName: string;
  seasonStatus: string;
  currentVoter: CaptainVoterOption | null;
  candidates: CaptainCandidateRow[];
  votes: CaptainVoteRecord[];
}

export function CaptainVotingPanel({
  seasonName,
  seasonStatus,
  currentVoter,
  candidates,
  votes,
}: CaptainVotingPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isVotingOpen = seasonStatus === "voting";

  useEffect(() => {
    if (!isVotingOpen) return;
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [isVotingOpen, router]);

  // votes 已在服务端按当前用户过滤
  const votedCandidateIds = new Set(votes.map((vote) => vote.candidateRegistrationId));
  const maxVotes = Math.max(1, ...candidates.map((candidate) => candidate.voteCount));

  useEffect(() => {
    if (!isVotingOpen) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel("captain-votes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "captain_votes" },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isVotingOpen, router]);

  function handleCast(candidateId: string) {
    if (!currentVoter) {
      toast.error("请先登录并完成报名审核");
      return;
    }

    startTransition(async () => {
      const result = await castVote({
        voterRegistrationId: currentVoter.id,
        candidateRegistrationId: candidateId,
      });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success("投票成功");
      router.refresh();
    });
  }

  function handleRetract(candidateId: string) {
    if (!currentVoter) return;
    startTransition(async () => {
      const result = await retractVote({
        voterRegistrationId: currentVoter.id,
        candidateRegistrationId: candidateId,
      });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success("已撤回投票");
      router.refresh();
    });
  }

  return (
    <>
      {/* ── 移动端布局（< md）──────────────────────────── */}
      <div className="md:hidden space-y-4">
        {/* 投票状态栏 */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-base font-semibold">{seasonName} 队长候选</h2>
            {currentVoter && (
              <p className="mt-0.5 text-xs text-[var(--color-fg-mid)]">
                已投 {votes.length} / {MAX_CAPTAIN_VOTES} 票
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isVotingOpen ? "default" : "secondary"} className="text-xs">
              {isVotingOpen ? "投票开放" : "结果展示"}
            </Badge>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="p-1.5 rounded-sm border border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-dim)] transition-colors"
              aria-label="刷新票数"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {!currentVoter && (
          <p className="text-xs text-[var(--color-fg-mid)] border border-[var(--color-border)] rounded-sm px-3 py-2">
            请先登录并通过报名审核后方可投票。
          </p>
        )}

        {candidates.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-fg-mid)] border border-[var(--color-border)] rounded-sm">
            暂无符合条件的队长候选人
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map((candidate, index) => {
              const hasVoted = votedCandidateIds.has(candidate.id);
              const voteDisabled =
                !isVotingOpen ||
                isPending ||
                !currentVoter ||
                currentVoter.id === candidate.id ||
                (!hasVoted && votes.length >= MAX_CAPTAIN_VOTES);
              const voteBarPct = Math.round((candidate.voteCount / maxVotes) * 100);

              return (
                <div
                  key={candidate.id}
                  className="border border-[var(--color-border)] bg-[var(--color-panel)] rounded-sm p-3"
                >
                  {/* 头部：排名 + 名字 + 位置 + 票数 */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono text-xs text-[var(--color-fg-dim)] shrink-0">
                        #{index + 1}
                      </span>
                      <span className="text-sm font-semibold text-[var(--color-fg)] truncate">
                        {candidate.displayName}
                      </span>
                      {index < 8 && (
                        <span className="shrink-0 text-[10px] font-mono text-[var(--color-accent)] border border-[var(--color-accent)]/40 rounded-sm px-1">
                          前8
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-sm font-semibold text-[var(--color-fg)] ml-2 shrink-0">
                      {candidate.voteCount}
                      <span className="text-xs font-normal text-[var(--color-fg-dim)]"> 票</span>
                    </span>
                  </div>

                  {/* 位置信息 */}
                  <p className="text-xs text-[var(--color-fg-mid)] mb-2">
                    {positionLabel(candidate.primaryPosition)} · Peak {candidate.peakRank} · RT {candidate.peakRating} · Current RT {candidate.currentRating}
                  </p>

                  {/* 票数进度条 */}
                  <div className="h-1 bg-[var(--color-panel-low)] rounded-sm mb-3 overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all"
                      style={{ width: `${voteBarPct}%` }}
                    />
                  </div>

                  {/* 投票/撤票按钮 */}
                  {isVotingOpen && currentVoter && currentVoter.id !== candidate.id && (
                    <button
                      type="button"
                      disabled={voteDisabled}
                      onClick={() => hasVoted ? handleRetract(candidate.id) : handleCast(candidate.id)}
                      className={`w-full py-2 text-xs font-mono tracking-wide border rounded-sm transition-colors disabled:opacity-50 ${
                        hasVoted
                          ? "border-[var(--color-border)] text-[var(--color-fg-mid)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                          : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                      }`}
                    >
                      {hasVoted ? "撤回投票" : "投票"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 桌面端布局（≥ md）──────────────────────────── */}
      <div className="hidden md:grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <Card className="p-4">
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">我的投票</h2>
                <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                  每名已通过报名的选手最多投 {MAX_CAPTAIN_VOTES} 票。
                </p>
              </div>

              {currentVoter ? (
                <>
                  <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                    <p className="font-medium">{currentVoter.displayName}</p>
                    <p className="mt-0.5 text-[var(--color-fg-mid)]">
                      {positionLabel(currentVoter.primaryPosition)} · Peak {currentVoter.peakRank} · RT {currentVoter.peakRating}
                    </p>
                  </div>

                  <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--color-fg-mid)]">已投</span>
                      <span className="font-medium">
                        {votes.length} / {MAX_CAPTAIN_VOTES}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-[var(--color-accent)] transition-all"
                        style={{ width: `${(votes.length / MAX_CAPTAIN_VOTES) * 100}%` }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
                  请先登录并通过报名审核后方可投票。
                </p>
              )}

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => router.refresh()}
              >
                <RefreshCw />
                刷新票数
              </Button>
            </div>
          </Card>
        </aside>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{seasonName} 队长候选</h2>
              <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                当前状态：{seasonStatus}
              </p>
            </div>
            <Badge variant={isVotingOpen ? "default" : "secondary"}>
              {isVotingOpen ? "投票开放" : "结果展示"}
            </Badge>
          </div>

          {candidates.length === 0 ? (
            <Card className="p-8 text-center text-sm text-[var(--color-fg-mid)]">
              暂无符合条件的队长候选人
            </Card>
          ) : (
            <div className="space-y-3">
              {candidates.map((candidate, index) => {
                const hasVoted = votedCandidateIds.has(candidate.id);
                const voteDisabled =
                  !isVotingOpen ||
                  isPending ||
                  !currentVoter ||
                  currentVoter.id === candidate.id ||
                  (!hasVoted && votes.length >= MAX_CAPTAIN_VOTES);

                return (
                  <Card key={candidate.id} className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={index < 8 ? "default" : "outline"}>
                            #{index + 1}
                          </Badge>
                          <h3 className="font-semibold">{candidate.displayName}</h3>
                          {index < 8 && (
                            <Badge variant="secondary" className="text-xs">
                              当前前 8
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                          {positionLabel(candidate.primaryPosition)} · Peak {candidate.peakRank} ·
                          RT {candidate.peakRating} · Current RT {candidate.currentRating}
                        </p>
                        <div className="mt-3 h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-[var(--color-accent)] transition-all"
                            style={{ width: `${(candidate.voteCount / maxVotes) * 100}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3 sm:shrink-0">
                        <div className="w-14 text-right">
                          <div className="text-lg font-semibold">{candidate.voteCount}</div>
                          <div className="text-xs text-[var(--color-fg-mid)]">票</div>
                        </div>
                        {hasVoted ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!isVotingOpen || isPending}
                            onClick={() => handleRetract(candidate.id)}
                          >
                            <Undo2 />
                            撤回
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            disabled={voteDisabled}
                            onClick={() => handleCast(candidate.id)}
                          >
                            <Vote />
                            投票
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function positionLabel(key: string): string {
  return POSITION_LABELS[key as keyof typeof POSITION_LABELS]?.cn ?? key;
}
