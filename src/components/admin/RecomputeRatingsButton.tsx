"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { recomputeSeasonRatings } from "@/actions/compute-season-ratings";

interface RecomputeRatingsButtonProps {
  seasonId: string;
}

export function RecomputeRatingsButton({ seasonId }: RecomputeRatingsButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await recomputeSeasonRatings(seasonId);
      if (result.success) {
        toast.success(
          `评分重算完成（${result.data.playerCount} 名选手，权重 ${result.data.weightsVersion}）`,
        );
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
    >
      {isPending ? "重算中…" : "重算 RR/PRISM 评分"}
    </button>
  );
}
