import React from "react";
import { cn } from "@/lib/utils/cn";
import type { DemoRoundRow } from "@/actions/demo-detail";

interface DemoRoundTimelineProps {
  rounds: DemoRoundRow[];
}

const END_REASON_LABELS: Record<string, string> = {
  bomb_exploded: "Bomb exploded",
  bomb_defused: "Defused",
  ct_win: "CT elim.",
  t_win: "T elim.",
  target_saved: "Target saved",
  target_bombed: "Bomb exploded",
  defuse: "Defused",
  time_over: "Time over",
};

function endReasonLabel(reason: string | null): string {
  if (!reason) return "—";
  return END_REASON_LABELS[reason] ?? reason;
}

/** Horizontal round timeline component. */
export function DemoRoundTimeline({ rounds }: DemoRoundTimelineProps) {
  if (rounds.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-dim)] py-2">No round data</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1.5 min-w-max pb-1">
        {rounds.map((r) => {
          const isTWin = r.winnerSide === "t";
          const isCTWin = r.winnerSide === "ct";
          const isWin = !!(isTWin || isCTWin);

          return (
            <div
              key={r.roundNumber}
              className={cn(
                "flex flex-col items-center rounded px-2 py-1.5 min-w-[60px] text-center",
                "border border-[var(--color-border)]",
                isTWin && "bg-amber-900/20 border-amber-700/30",
                isCTWin && "bg-sky-900/20 border-sky-700/30",
                !isWin && "bg-[var(--color-bg-subtle)]",
              )}
            >
              <span className="text-[10px] font-bold text-[var(--color-fg)]">
                R{r.roundNumber}
              </span>
              <span className="text-[10px] font-mono mt-0.5">
                {isTWin && <span className="text-amber-400">T</span>}
                {isCTWin && <span className="text-sky-400">CT</span>}
                {!isWin && <span className="text-[var(--color-fg-dim)]">—</span>}
              </span>
              <span className="text-[9px] text-[var(--color-fg-dim)] mt-0.5 tabular-nums">
                {r.teamAScoreBefore ?? "?"}:{r.teamBScoreBefore ?? "?"}
              </span>
              <span className="text-[8px] text-[var(--color-fg-dim)] mt-0.5 leading-tight truncate max-w-[56px]">
                {endReasonLabel(r.endReason)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
