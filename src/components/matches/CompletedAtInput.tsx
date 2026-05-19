"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMatchCompletedAt } from "@/actions/matches";

interface CompletedAtInputProps {
  matchId: string;
  initialValue: string | null;
}

export function CompletedAtInput({ matchId, initialValue }: CompletedAtInputProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await updateMatchCompletedAt(matchId, value || null);
      if (result.success) {
        toast.success(value ? "完成时间已更新" : "完成时间已清除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleClear() {
    setValue("");
    startTransition(async () => {
      const result = await updateMatchCompletedAt(matchId, null);
      if (result.success) {
        toast.success("完成时间已清除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--color-fg-mid)] shrink-0">完成时间（CST）</span>
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-48 text-xs h-8"
        disabled={isPending}
      />
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSave} disabled={isPending}>
        保存
      </Button>
      {initialValue && (
        <Button size="sm" variant="ghost" className="h-8 text-xs text-[var(--color-fg-mid)]" onClick={handleClear} disabled={isPending}>
          清除
        </Button>
      )}
    </div>
  );
}
