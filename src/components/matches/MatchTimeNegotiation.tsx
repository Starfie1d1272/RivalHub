"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { proposeMatchTime, respondToTimeProposal, forceSetMatchTime } from "@/actions/matches/scheduling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCST } from "@/lib/utils/date";
import type { matchTimeProposals } from "@/db/schema/match-time-proposals";

type Proposal = typeof matchTimeProposals.$inferSelect;

interface MatchTimeNegotiationProps {
  matchId: string;
  isCaptainA: boolean;
  isCaptainB: boolean;
  isAdmin: boolean;
  currentUserId?: string;
  currentScheduledAt: Date | null;
  currentCompletionDeadline: Date | null;
  initialProposals: Proposal[];
}

export function MatchTimeNegotiation({
  matchId,
  isCaptainA,
  isCaptainB,
  isAdmin,
  currentUserId,
  currentScheduledAt,
  currentCompletionDeadline,
  initialProposals,
}: MatchTimeNegotiationProps) {
  const [isPending, startTransition] = useTransition();
  const [proposedTime, setProposedTime] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const isCaptain = isCaptainA || isCaptainB;

  const pendingProposal = initialProposals.find((p) => p.status === "pending");
  const completionDeadline = currentCompletionDeadline
    ? new Date(currentCompletionDeadline)
    : null;
  const confirmationCutoff = completionDeadline
    ? new Date(completionDeadline.getTime() - 24 * 60 * 60 * 1000)
    : null;
  const isNegotiationClosed =
    confirmationCutoff !== null && Date.now() >= confirmationCutoff.getTime();
  const isOpponentProposal =
    pendingProposal !== undefined &&
    isCaptain &&
    currentUserId !== undefined &&
    pendingProposal.proposedBy !== currentUserId;

  const handlePropose = () => {
    if (!proposedTime) return;
    startTransition(async () => {
      const result = await proposeMatchTime(matchId, new Date(proposedTime));
      if (result.success) {
        toast.success("时间提议已发送");
        setProposedTime("");
      } else {
        toast.error(result.error.message ?? "提议失败");
      }
    });
  };

  const handleRespond = (action: "accept" | "reject") => {
    if (!pendingProposal) return;
    startTransition(async () => {
      const result = await respondToTimeProposal(
        pendingProposal.id,
        action,
        action === "reject" ? rejectReason : undefined,
      );
      if (result.success) {
        toast.success(action === "accept" ? "已接受提议" : "已拒绝提议");
        setRejectReason("");
        setRejectingId(null);
      } else {
        toast.error(result.error.message ?? "操作失败");
      }
    });
  };

  const handleForceSet = () => {
    if (!proposedTime) return;
    startTransition(async () => {
      const result = await forceSetMatchTime(matchId, new Date(proposedTime));
      if (result.success) {
        toast.success("比赛时间已设定");
        setProposedTime("");
      } else {
        toast.error(result.error.message ?? "设定失败");
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* 当前时间 */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">比赛时间：</span>
        <span className="text-sm">
          {currentScheduledAt ? formatCST(currentScheduledAt) : "待协商"}
        </span>
      </div>

      {/* 待回应的对方提议 */}
      {isOpponentProposal && pendingProposal && (
        <div className="rounded border border-yellow-200 bg-yellow-50 p-3 dark:bg-yellow-950/20">
          <p className="text-sm font-medium">
            对方提议时间：{formatCST(pendingProposal.proposedTime)}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => handleRespond("accept")}
              disabled={isPending || isNegotiationClosed}
            >
              接受
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejectingId(pendingProposal.id)}
              disabled={isPending || isNegotiationClosed}
            >
              拒绝
            </Button>
          </div>
          {rejectingId === pendingProposal.id && (
            <div className="mt-2 space-y-2">
              <Label htmlFor="reject-reason">拒绝原因</Label>
              <Input
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="请填写拒绝原因"
                maxLength={200}
              />
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleRespond("reject")}
                disabled={isPending || isNegotiationClosed || !rejectReason.trim()}
              >
                确认拒绝
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 队长提议表单 */}
      {isCaptain && !isOpponentProposal && !isNegotiationClosed && (
        <div className="space-y-2">
          <Label htmlFor="propose-time">提议新时间</Label>
          <div className="flex gap-2">
            <Input
              id="propose-time"
              type="datetime-local"
              value={proposedTime}
              onChange={(e) => setProposedTime(e.target.value)}
              max={completionDeadline ? toLocalDatetimeValue(completionDeadline) : undefined}
            />
            <Button
              onClick={handlePropose}
              disabled={isPending || !proposedTime}
            >
              提议
            </Button>
          </div>
        </div>
      )}

      <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-fg-mid)]">
        <div>
          最晚完成时间：{completionDeadline ? formatCST(completionDeadline) : "管理员暂未设置"}
        </div>
        <div>
          协商截止时间：{confirmationCutoff ? formatCST(confirmationCutoff) : "设置最晚完成时间后自动生成"}
        </div>
        {isNegotiationClosed && (
          <div className="mt-1 text-[var(--color-danger)]">
            队长时间协商已截止，请联系管理员指定比赛时间。
          </div>
        )}
      </div>

      {/* 管理员强制指定 */}
      {isAdmin && (
        <div className="rounded border border-red-200 p-3 dark:bg-red-950/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            管理员强制指定
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              type="datetime-local"
              value={proposedTime}
              onChange={(e) => setProposedTime(e.target.value)}
              max={completionDeadline ? toLocalDatetimeValue(completionDeadline) : undefined}
            />
            <Button
              variant="destructive"
              onClick={handleForceSet}
              disabled={isPending || !proposedTime}
            >
              强制设定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalDatetimeValue(date: Date): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
