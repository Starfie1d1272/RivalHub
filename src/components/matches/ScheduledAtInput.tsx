"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { parseCSTInput, toCSTDateTimeInput } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMatchCompletionDeadline, updateMatchScheduledAt } from "@/actions/matches";

interface ScheduledAtInputProps {
  matchId: string;
  currentScheduledAt: Date | null;
  currentCompletionDeadline: Date | null;
}

export function ScheduledAtInput({
  matchId,
  currentScheduledAt,
  currentCompletionDeadline,
}: ScheduledAtInputProps) {
  const [value, setValue] = useState(toCSTDateTimeInput(currentScheduledAt) ?? "");
  const [deadlineValue, setDeadlineValue] = useState(toCSTDateTimeInput(currentCompletionDeadline) ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const date = value ? parseCSTInput(value) : null;
    if (value && !date) {
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

  function handleSaveDeadline() {
    const date = deadlineValue ? parseCSTInput(deadlineValue) : null;
    if (deadlineValue && !date) {
      toast.error("请输入有效的最晚完成时间");
      return;
    }
    startTransition(async () => {
      const result = await updateMatchCompletionDeadline(matchId, date);
      if (result.success) {
        toast.success(date ? "最晚完成时间已更新" : "最晚完成时间已清除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleClearDeadline() {
    setDeadlineValue("");
    startTransition(async () => {
      const result = await updateMatchCompletionDeadline(matchId, null);
      if (result.success) {
        toast.success("最晚完成时间已清除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--color-fg-mid)] shrink-0">比赛时间</span>
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
          <Button size="sm" variant="ghost" className="h-8 text-xs text-[var(--color-fg-mid)]" onClick={handleClear} disabled={isPending}>
            清除
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--color-fg-mid)] shrink-0">最晚完成</span>
        <Input
          type="datetime-local"
          value={deadlineValue}
          onChange={(e) => setDeadlineValue(e.target.value)}
          className="w-48 text-xs h-8"
          disabled={isPending}
        />
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSaveDeadline} disabled={isPending}>
          保存
        </Button>
        {currentCompletionDeadline && (
          <Button size="sm" variant="ghost" className="h-8 text-xs text-[var(--color-fg-mid)]" onClick={handleClearDeadline} disabled={isPending}>
            清除
          </Button>
        )}
        <span className="text-xs text-[var(--color-fg-dim)]">
          队长可协商至此时间；计划开赛须为未来时间且不晚于此时间。首次提议满 24 小时、距开赛至少 2 小时才可自动采纳。
        </span>
      </div>
    </div>
  );
}
