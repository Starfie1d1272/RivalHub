"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { batchSetCompletionDeadline as telemetry_batchSetCompletionDeadline } from "@/actions/matches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/rivalhub";
import { parseCSTInput } from "@/lib/utils/date";
import { observeAction } from "@/lib/telemetry/client";

const batchSetCompletionDeadline = observeAction(
  "matches.batchSetCompletionDeadline",
  telemetry_batchSetCompletionDeadline,
);

interface RoundGroup {
  label: string;
  stage: string;
  round?: number | null;
  entryRound?: string | null;
  matchCount: number;
}

interface BatchDeadlineCardProps {
  seasonId: string;
  groups: RoundGroup[];
}

export function BatchDeadlineCard({ seasonId, groups }: BatchDeadlineCardProps) {
  const id = useId();
  const [deadlines, setDeadlines] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) return null;

  function getGroupKey(g: RoundGroup) {
    return `${g.stage}:${g.round ?? ""}:${g.entryRound ?? ""}`;
  }

  function handleSubmit(group: RoundGroup) {
    const key = getGroupKey(group);
    const deadline = parseCSTInput(deadlines[key] ?? null);
    if (!deadline) {
      setErrors((previous) => ({ ...previous, [key]: "请输入有效的北京时间。" }));
      return;
    }

    setErrors((previous) => ({ ...previous, [key]: "" }));
    startTransition(async () => {
      try {
        const result = await batchSetCompletionDeadline({
          seasonId,
          stage: group.stage,
          round: group.round,
          entryRound: group.entryRound,
          completionDeadline: deadline,
        });
        if (result.success) {
          toast.success(`已为 ${result.data.updated} 场比赛设置截止时间`);
        } else {
          setErrors((previous) => ({ ...previous, [key]: result.error.message }));
        }
      } catch {
        setErrors((previous) => ({ ...previous, [key]: "未能确认设置结果，请刷新赛程后核对。" }));
      }
    });
  }

  return (
    <Panel contentClassName="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-[var(--color-fg)]">批量设置最晚完成时间</h2>
      <p className="text-xs text-[var(--color-fg-mid)]">
        按阶段和轮次设置，适用于待进行和进行中的比赛。
      </p>
      <div className="space-y-3">
        {groups.map((group, index) => {
          const key = getGroupKey(group);
          const inputId = `${id}-${index}`;
          const error = errors[key];
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <Label htmlFor={inputId} className="text-xs">
                    {group.label} · 最晚完成时间（北京时间）
                    <span className="ml-1 text-[var(--color-fg-dim)]">({group.matchCount} 场)</span>
                  </Label>
                  <Input
                    id={inputId}
                    type="datetime-local"
                    value={deadlines[key] ?? ""}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : undefined}
                    onChange={(event) => {
                      setDeadlines((previous) => ({ ...previous, [key]: event.target.value }));
                      setErrors((previous) => ({ ...previous, [key]: "" }));
                    }}
                    className="mt-1 max-w-full"
                    disabled={isPending}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  aria-label={`为${group.label}应用最晚完成时间`}
                  onClick={() => handleSubmit(group)}
                  disabled={isPending || !deadlines[key]}
                >
                  应用本组
                </Button>
              </div>
              {error && (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="text-sm text-[var(--color-danger)]"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
