"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateMatchStatus } from "@/actions/matches";

interface ScoreInputProps {
  matchId: string;
  currentStatus: "scheduled" | "in_progress" | "finished" | "cancelled";
  allowCancel?: boolean;
}

/**
 * Scheduled-match cancellation control. Match start is coordinated in Veto Room.
 *
 * Normal results are entered through MapByMapInput so every format writes the
 * actual round score to match_maps before matches receives the derived series
 * score.
 */
export function ScoreInput({ matchId, currentStatus, allowCancel = true }: ScoreInputProps) {
  const [isPending, startTransition] = useTransition();

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
  if (!allowCancel) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleCancel} disabled={isPending}>
        取消比赛
      </Button>
    </div>
  );
}
