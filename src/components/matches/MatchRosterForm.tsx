"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { submitMatchRoster } from "@/actions/matches/roster";
import { Button } from "@/components/ui/button";
import { PosChip, StatusPill } from "@/components/rivalhub";

interface TeamMember {
  id: string;
  steamName: string;
  primaryPosition: string;
}

interface MatchRosterFormProps {
  matchId: string;
  teamMembers: TeamMember[];
  hasExistingRoster: boolean;
}

export function MatchRosterForm({
  matchId,
  teamMembers,
  hasExistingRoster,
}: MatchRosterFormProps) {
  const [isPending, startTransition] = useTransition();

  function playerBtnClass(isSelected: boolean, isDisabled = false) {
    const base = "flex flex-col items-start gap-1 rounded border p-2 text-left transition-colors";
    if (isDisabled) return `${base} cursor-not-allowed border-[var(--color-border)] opacity-40`;
    return isSelected
      ? `${base} border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-fg)]`
      : `${base} border-[var(--color-border)] text-[var(--color-fg)] hover:border-[var(--color-accent)]/50`;
  }
  const [selectedStarterIds, setSelectedStarterIds] = useState<string[]>([]);
  const [selectedSubstituteIds, setSelectedSubstituteIds] = useState<string[]>([]);

  const toggleStarter = (id: string) => {
    setSelectedStarterIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 5
          ? [...prev, id]
          : prev,
    );
    setSelectedSubstituteIds((prev) => prev.filter((x) => x !== id));
  };

  const toggleSubstitute = (id: string) => {
    if (selectedStarterIds.includes(id)) return;
    setSelectedSubstituteIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 2
          ? [...prev, id]
          : prev,
    );
  };

  const handleSubmit = () => {
    if (selectedStarterIds.length !== 5) {
      toast.error("请选择 5 名首发");
      return;
    }
    startTransition(async () => {
      const result = await submitMatchRoster(matchId, selectedStarterIds, selectedSubstituteIds);
      if (result.success) {
        toast.success("名单提交成功");
      } else {
        toast.error(result.error.message ?? "提交失败");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-fg)]">提交赛前名单</span>
        {hasExistingRoster && <StatusPill status="finished" />}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--color-fg)]">首发</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleStarter(m.id)}
              className={playerBtnClass(selectedStarterIds.includes(m.id))}
            >
              <span className="text-sm font-medium">{m.steamName}</span>
              <PosChip pos={m.primaryPosition} />
            </button>
          ))}
        </div>
        <p className="text-sm text-[var(--color-fg-dim)]">
          已选 {selectedStarterIds.length}/5 名首发
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--color-fg)]">替补</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleSubstitute(m.id)}
              disabled={selectedStarterIds.includes(m.id)}
              className={playerBtnClass(
                selectedSubstituteIds.includes(m.id),
                selectedStarterIds.includes(m.id),
              )}
            >
              <span className="text-sm font-medium">{m.steamName}</span>
              <PosChip pos={m.primaryPosition} />
            </button>
          ))}
        </div>
        <p className="text-sm text-[var(--color-fg-dim)]">
          已选 {selectedSubstituteIds.length}/2 名替补（可不选）
        </p>
      </div>

      {!hasExistingRoster && (
        <Button
          onClick={handleSubmit}
          disabled={isPending || selectedStarterIds.length !== 5}
          size="sm"
        >
          提交名单
        </Button>
      )}
      {hasExistingRoster && (
        <div className="flex items-center gap-2">
          <StatusPill status="finished" />
          <span className="text-sm text-[var(--color-fg-dim)]">
            名单已锁定，如需修改请联系管理员
          </span>
        </div>
      )}
    </div>
  );
}
