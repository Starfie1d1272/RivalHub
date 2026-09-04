"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { updateMatchStatus } from "@/actions/matches";

interface ScoreInputProps {
  matchId: string;
  currentStatus: "scheduled" | "in_progress" | "finished" | "cancelled";
  startBlockers?: string[];
}

/**
 * Scheduled-match controls only.
 *
 * Normal results are entered through MapByMapInput so every format writes the
 * actual round score to match_maps before matches receives the derived series
 * score.
 */
export function ScoreInput({ matchId, currentStatus, startBlockers = [] }: ScoreInputProps) {
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const result = await updateMatchStatus(matchId, "in_progress");
      if (result.success) {
        toast.success("比赛已开始");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await updateMatchStatus(matchId, "cancelled");
      if (result.success) {
        toast.success("比赛已取消");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  if (currentStatus !== "scheduled") return null;

  return (
    <div className="space-y-3">
      {showStartConfirm ? (
        <InlineConfirm
          title="确认开始比赛？"
          sub="开始后比赛状态将变为「进行中」，正常赛果请按地图录入"
          onConfirm={handleStart}
          onCancel={() => setShowStartConfirm(false)}
        />
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setShowStartConfirm(true)}
            disabled={isPending || startBlockers.length > 0}
          >
            开始比赛
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel} disabled={isPending}>
            取消比赛
          </Button>
        </div>
      )}
      {startBlockers.length > 0 && (
        <p className="text-xs leading-5 text-[var(--color-warn)]">
          无法开始：{startBlockers.join("；")}
        </p>
      )}
    </div>
  );
}
