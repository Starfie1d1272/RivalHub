"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { batchSetCompletionDeadline } from "@/actions/matches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/rivalhub";
import { parseCSTInput } from "@/lib/utils/date";

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
  const [deadlines, setDeadlines] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) return null;

  function getGroupKey(g: RoundGroup) {
    return `${g.stage}:${g.round ?? ""}:${g.entryRound ?? ""}`;
  }

  function handleSubmit(group: RoundGroup) {
    const key = getGroupKey(group);
    const value = deadlines[key];
    if (!value) return;
    const deadline = parseCSTInput(value);
    if (!deadline) return;

    startTransition(async () => {
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
        toast.error(result.error.message ?? "设置失败");
      }
    });
  }

  return (
    <Panel pad={16} className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--color-fg)]">
        批量设置截止时间
      </h3>
      <p className="text-xs text-[var(--color-fg-mid)]">
        按阶段/轮次统一设置最晚完成时间，仅影响 scheduled / in_progress 状态的比赛
      </p>
      <div className="space-y-3">
        {groups.map((group) => {
          const key = getGroupKey(group);
          return (
            <div
              key={key}
              className="flex items-end gap-3 flex-wrap"
            >
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs">
                  {group.label}
                  <span className="ml-1 text-[var(--color-fg-dim)]">
                    ({group.matchCount} 场)
                  </span>
                </Label>
                <Input
                  type="datetime-local"
                  value={deadlines[key] ?? ""}
                  onChange={(e) =>
                    setDeadlines((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className="mt-1"
                />
              </div>
              <Button
                size="sm"
                onClick={() => handleSubmit(group)}
                disabled={isPending || !deadlines[key]}
              >
                应用
              </Button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
