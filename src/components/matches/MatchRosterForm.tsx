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
  scheduledAt: Date | null;
}

export function MatchRosterForm({
  matchId,
  teamMembers,
  hasExistingRoster,
  scheduledAt,
}: MatchRosterFormProps) {
  const hoursUntilMatch = scheduledAt
    ? Math.floor((scheduledAt.getTime() - Date.now()) / (1000 * 60 * 60))
    : null;
  const isWithin2Hours = hoursUntilMatch !== null && hoursUntilMatch < 2;
  const isMatchStarted = hoursUntilMatch !== null && hoursUntilMatch <= 0;
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
        <div className="rounded border p-3" style={{ borderColor: "rgba(255,84,112,0.35)", background: "rgba(255,84,112,0.06)" }}>
          <p className="text-sm text-[var(--color-fg)]">比赛已开始，名单不可修改</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            如需调整请联系管理员
          </p>
        </div>
      ) : isWithin2Hours ? (
        <div className="rounded border p-3" style={{ borderColor: "rgba(255,196,77,0.4)", background: "rgba(255,196,77,0.06)" }}>
          <p className="text-sm text-[var(--color-fg)]">距开赛不足 2 小时，名单已锁定</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            如需修改请联系管理员解锁
          </p>
        </div>
      ) : hoursUntilMatch !== null ? (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2">
          <p className="text-xs text-[var(--color-fg-dim)]">
            距开赛还有 {hoursUntilMatch} 小时。开赛前 2 小时名单将锁定，届时无法修改，请在此之前提交名单。裁判在开赛时会检查队员信息，队员不正确将无法进行比赛。
          </p>
        </div>
      ) : (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
          <p className="text-sm text-[var(--color-fg-dim)]">比赛时间未确定</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            请等待管理员设置比赛时间或通过时间协商确认时间后，再提交名单
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
              disabled={isWithin2Hours || isMatchStarted}
              className={playerBtnClass(selectedStarterIds.includes(m.id), isWithin2Hours || isMatchStarted)}
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
              disabled={selectedStarterIds.includes(m.id) || isWithin2Hours || isMatchStarted}
              className={playerBtnClass(
                selectedSubstituteIds.includes(m.id),
                selectedStarterIds.includes(m.id) || isWithin2Hours || isMatchStarted,
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

      {!isWithin2Hours && !isMatchStarted && (
        <Button
          onClick={handleSubmit}
          disabled={isPending || selectedStarterIds.length !== 5}
          size="sm"
        >
          提交名单
        </Button>
      )}
      {isWithin2Hours && hasExistingRoster && (
        <p className="text-xs text-[var(--color-fg-dim)]">
          名单已锁定，距开赛不足 2 小时
        </p>
      )}
    </div>
  );
}
