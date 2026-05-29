"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { backfillEconomyTypes } from "@/actions/backfill-economy";

interface BackfillEconomyButtonProps {
  seasonId: string;
}

export function BackfillEconomyButton({ seasonId: _seasonId }: BackfillEconomyButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await backfillEconomyTypes();
      if (result.success) {
        toast.success(`经济类型回填完成，更新 ${result.data.updatedRounds} 回合`);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="text-xs px-3 py-1 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-40"
    >
      {isPending ? "回填中…" : "回填经济类型"}
    </button>
  );
}
