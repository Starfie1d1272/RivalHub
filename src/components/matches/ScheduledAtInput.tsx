"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMatchScheduledAt } from "@/actions/matches";

interface ScheduledAtInputProps {
  matchId: string;
  currentScheduledAt: Date | null;
}

function toLocalDatetimeValue(date: Date | null): string {
  if (!date) return "";
  // datetime-local 需要 "YYYY-MM-DDTHH:mm" 格式，转本地时间
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduledAtInput({ matchId, currentScheduledAt }: ScheduledAtInputProps) {
  const [value, setValue] = useState(toLocalDatetimeValue(currentScheduledAt));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const date = value ? new Date(value) : null;
    if (value && isNaN(date!.getTime())) {
      toast.error("请输入有效的时间");
      return;
    }
    startTransition(async () => {
      const result = await updateMatchScheduledAt(matchId, date);
      if (result.success) {
        toast.success(date ? "比赛时间已更新" : "比赛时间已清除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleClear() {
    setValue("");
    startTransition(async () => {
      const result = await updateMatchScheduledAt(matchId, null);
      if (result.success) {
        toast.success("比赛时间已清除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--text-secondary)] shrink-0">比赛时间</span>
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
      {currentScheduledAt && (
        <Button size="sm" variant="ghost" className="h-8 text-xs text-[var(--text-secondary)]" onClick={handleClear} disabled={isPending}>
          清除
        </Button>
      )}
    </div>
  );
}
