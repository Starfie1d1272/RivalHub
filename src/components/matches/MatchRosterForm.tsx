"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { submitMatchRoster } from "@/actions/matches/roster";
import { Button } from "@/components/ui/button";
import { PosChip } from "@/components/rivalhub";

import { getDisplayName } from "@/lib/utils/display-name";

interface TeamMember {
  id: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

interface MatchRosterFormProps {
  matchId: string;
  teamMembers: TeamMember[];
  hasExistingRoster: boolean;
  matchStatus: "scheduled" | "in_progress" | "finished" | "cancelled";
  rosterStatus: string | null;
}

export function MatchRosterForm({
  matchId,
  teamMembers,
  hasExistingRoster,
  matchStatus,
  rosterStatus,
}: MatchRosterFormProps) {
  const isMatchStarted = matchStatus !== "scheduled";
  const rosterLocked = rosterStatus === "confirmed";
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
      const result = await submitMatchRoster(matchId, { starterIds: selectedStarterIds, substituteIds: selectedSubstituteIds });
      if (result.success) {
        toast.success("名单提交成功");
      } else {
        toast.error(result.error.message ?? "提交失败");
      }
    });
  };

  return (
    <div className="space-y-4">
      {isMatchStarted ? (
        <div className="rounded border p-3" style={{ borderColor: "var(--color-danger-edge)", background: "var(--color-danger-soft)" }}>
          <p className="text-sm text-[var(--color-fg)]">比赛已开始，名单不可修改</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            如需调整请联系管理员
          </p>
        </div>
      ) : rosterLocked ? (
        <div className="rounded border p-3" style={{ borderColor: "var(--color-warn-edge)", background: "var(--color-warn-soft)" }}>
          <p className="text-sm text-[var(--color-fg)]">名单已由管理员确认</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            如需修改请联系管理员解锁后重新提交。
          </p>
        </div>
      ) : (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2">
          <p className="text-xs text-[var(--color-fg-dim)]">
            比赛尚未开始。提交后由管理员确认；确认后如需调整，必须由管理员显式解锁。裁判开赛时会再次检查队员资格。
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-fg)]">提交赛前名单</span>
        {hasExistingRoster && <span className="text-xs text-[var(--color-fg-dim)]">已提交</span>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--color-fg)]">首发</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleStarter(m.id)}
              disabled={rosterLocked || isMatchStarted}
              className={playerBtnClass(selectedStarterIds.includes(m.id), rosterLocked || isMatchStarted)}
            >
              <span className="text-sm font-medium">{getDisplayName(m)}</span>
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
              disabled={selectedStarterIds.includes(m.id) || rosterLocked || isMatchStarted}
              className={playerBtnClass(
                selectedSubstituteIds.includes(m.id),
                selectedStarterIds.includes(m.id) || rosterLocked || isMatchStarted,
              )}
            >
              <span className="text-sm font-medium">{getDisplayName(m)}</span>
              <PosChip pos={m.primaryPosition} />
            </button>
          ))}
        </div>
        <p className="text-sm text-[var(--color-fg-dim)]">
          已选 {selectedSubstituteIds.length}/2 名替补（可不选）
        </p>
      </div>

      {!rosterLocked && !isMatchStarted && (
        <Button
          onClick={handleSubmit}
          disabled={isPending || selectedStarterIds.length !== 5}
          size="sm"
        >
          提交名单
        </Button>
      )}
      {rosterLocked && hasExistingRoster && (
        <p className="text-xs text-[var(--color-fg-dim)]">
          名单已确认，等待比赛开始
        </p>
      )}
    </div>
  );
}
