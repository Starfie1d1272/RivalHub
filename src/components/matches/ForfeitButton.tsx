"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forfeitMatch } from "@/actions/matches";

interface ForfeitButtonProps {
  matchId: string;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
}

export function ForfeitButton({
  matchId,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
}: ForfeitButtonProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleForfeit(loserTeamId: string) {
    startTransition(async () => {
      const result = await forfeitMatch(matchId, loserTeamId, reason);
      if (result.success) {
        toast.success("弃赛已记录");
        setExpanded(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  if (!expanded) {
    return (
      <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
        判负弃赛
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--color-fg-mid)]">确认弃赛方并记录原因：</span>
      <Input value={reason} onChange={(event) => setReason(event.target.value)} className="h-8 min-w-48" placeholder="例如：超过宽限仍无法组成合法首发" />
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending || !reason.trim()}
        onClick={() => handleForfeit(teamAId)}
      >
        {teamAName} 弃赛
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending || !reason.trim()}
        onClick={() => handleForfeit(teamBId)}
      >
        {teamBName} 弃赛
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => setExpanded(false)}
      >
        取消
      </Button>
    </div>
  );
}
