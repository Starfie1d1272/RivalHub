"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { updateMatchStatus as telemetry_updateMatchStatus } from "@/actions/matches";
import { observeAction } from "@/lib/telemetry/client";
import type { MatchStatus } from "@/types/match";

const updateMatchStatus = observeAction("matches.updateMatchStatus", telemetry_updateMatchStatus);

interface ScoreInputProps {
  matchId: string;
  currentStatus: MatchStatus;
  allowCancel?: boolean;
  matchLabel: string;
  impact: { test: boolean; managed: boolean; bet: boolean };
}

export function ScoreInput({
  matchId,
  currentStatus,
  allowCancel = true,
  matchLabel,
  impact,
}: ScoreInputProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCancelMatch() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateMatchStatus(matchId, "cancelled");
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        setOpen(false);
        toast.success("比赛已取消");
      } catch {
        setError("未能确认取消结果，请返回工作台刷新比赛状态。");
      }
    });
  }

  if (currentStatus !== "scheduled" || !allowCancel) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return;
        setError(null);
        setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          取消比赛
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>取消这场比赛？</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {matchLabel}。取消后本场将进入终态，已有解说认领会被移除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm leading-6 text-[var(--color-fg-secondary)]">
          {impact.test ? (
            <p>影响仅限本场测试赛。</p>
          ) : impact.managed ? (
            <p>这场对阵属于托管赛程，依赖本场正式赛果的轮次或后续对阵将无法推进。</p>
          ) : (
            <p>采用自动收尾的赛事可能在最后一场正式比赛取消后结束。</p>
          )}
          {impact.bet && <p>已有竞猜盘口会锁定，并在后续结算时按作废规则退款。</p>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>返回工作台</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={handleCancelMatch}
          >
            {isPending ? "正在取消…" : "确认取消比赛"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
