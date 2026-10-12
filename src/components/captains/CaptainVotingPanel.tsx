"use client";

import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { useTransition } from "react";
import { useRoutePolling } from "@/components/use-visible-polling";
import { RefreshCw, Undo2, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { castVote, retractVote } from "@/actions/captains";
import { Button } from "@/components/ui/button";
import { MAX_CAPTAIN_VOTES } from "@/lib/captains/rules";
import { positionLabel } from "@/lib/validators/registration";
import type {
  PublicCaptainCandidate,
  CaptainVoteRecord,
  PublicCaptainVoter,
} from "@/lib/captains/data";

interface CaptainVotingPanelProps {
  seasonName: string;
  seasonStatus: string;
  currentVoter: PublicCaptainVoter | null;
  candidates: PublicCaptainCandidate[];
  votes: CaptainVoteRecord[];
}

export function CaptainVotingPanel({
  seasonStatus,
  currentVoter,
  candidates,
  votes,
}: CaptainVotingPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isVotingOpen = seasonStatus === "voting";

  useRoutePolling(isVotingOpen ? 10_000 : null, isPending);

  // votes 已在服务端按当前用户过滤
  const votedCandidateIds = new Set(votes.map((vote) => vote.candidateRegistrationId));

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

  return <div className={isVotingOpen ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]" : "space-y-4"}>
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{isVotingOpen ? "队长候选" : "最终票数"}</h2><span className="text-sm text-[var(--color-fg-mid)]">{candidates.length} 位候选人</span></div>
      {candidates.length === 0 ? <p className="py-10 text-sm text-[var(--color-fg-mid)]">暂无符合条件的队长候选人</p> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1760px]:grid-cols-4">
        {candidates.map((candidate, index) => {
          const hasVoted = votedCandidateIds.has(candidate.id);
          const voteDisabled = isPending || !currentVoter || currentVoter.id === candidate.id || (!hasVoted && votes.length >= MAX_CAPTAIN_VOTES);
          return <article key={candidate.id} className={`flex min-h-[176px] min-w-0 flex-col justify-between gap-4 rounded-[var(--radius-md)] border p-4 ${hasVoted ? "border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] bg-[var(--color-panel)]"}`}>
            <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="mb-2 font-mono text-xs text-[var(--color-fg-mid)]">#{String(index + 1).padStart(2, "0")} · {positionLabel(candidate.primaryPosition)}</p><h3 className="truncate text-lg font-semibold"><PlayerProfileLink userId={candidate.userId}>{candidate.displayName}</PlayerProfileLink></h3></div><div className="shrink-0 text-right"><p className="font-mono text-3xl font-semibold tabular-nums">{candidate.voteCount}</p><span className="text-xs text-[var(--color-fg-mid)]">票</span></div></div>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[var(--color-fg-mid)]">Peak {candidate.peakRank} · RT {candidate.peakRating}</span>{isVotingOpen && <Button size="sm" variant={hasVoted ? "outline" : "default"} disabled={voteDisabled} onClick={() => hasVoted ? handleRetract(candidate.id) : handleCast(candidate.id)}>{hasVoted ? <Undo2 size={14} /> : <Vote size={14} />}{currentVoter?.id === candidate.id ? "本人" : hasVoted ? "撤回" : "投票"}</Button>}</div>
          </article>;
        })}
      </div>}
    </section>
    {isVotingOpen && <aside className="space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-panel)] p-5 lg:sticky lg:top-20">
      <h2 className="text-lg font-semibold">我的投票</h2>
      {currentVoter ? <><p className="text-sm text-[var(--color-fg-mid)]">剩余 <strong className="font-mono text-2xl text-[var(--color-accent)]">{MAX_CAPTAIN_VOTES - votes.length}</strong> / {MAX_CAPTAIN_VOTES} 票</p><ul className="space-y-3 border-t border-[var(--color-border)] pt-4">{candidates.filter(candidate => votedCandidateIds.has(candidate.id)).map(candidate => <li key={candidate.id} className="flex items-center justify-between gap-2 text-sm"><PlayerProfileLink userId={candidate.userId}>{candidate.displayName}</PlayerProfileLink><Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleRetract(candidate.id)}>撤回</Button></li>)}</ul>{votes.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">尚未投票</p>}</> : <p className="text-sm text-[var(--color-fg-mid)]">请先登录并通过报名审核后方可投票。</p>}
      <p className="text-xs leading-5 text-[var(--color-fg-mid)]">投票即时生效，可以撤回；不能投给自己。</p><Button variant="outline" size="sm" onClick={() => router.refresh()}><RefreshCw size={14} />刷新票数</Button>
    </aside>}
  </div>;
}
