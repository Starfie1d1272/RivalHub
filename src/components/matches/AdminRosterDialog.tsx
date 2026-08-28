"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { getDisplayName } from "@/lib/utils/display-name";
import { adminSelectMatchRoster, confirmMatchRoster } from "@/actions/matches/roster";
import type { RosterData } from "@/components/matches/AdminMatchRow";

// ── Types ───────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

interface AdminRosterDialogProps {
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  teamAMembers: TeamMember[];
  teamBMembers: TeamMember[];
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
  allowSubstitutes?: boolean;
}

interface RosterTeamSectionProps {
  teamName: string;
  teamId: string;
  matchId: string;
  members: TeamMember[];
  existingRoster: RosterData | null;
  allowSubstitutes: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "已提交，待确认",
  unlocked: "已解锁，可重新提交",
  confirmed: "已确认",
};

// ── RosterTeamSection ───────────────────────────────────────────────────────

function RosterTeamSection({
  teamName,
  teamId,
  matchId,
  members,
  existingRoster,
  allowSubstitutes = true,
}: RosterTeamSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Two-step explicit flow: first pick, then review the exact five and confirm.
  const [pendingLineup, setPendingLineup] = useState<{ starterIds: string[]; substituteIds: string[] } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (existingRoster) {
      return [...existingRoster.starters, ...existingRoster.substitutes];
    }
    return [];
  });

  const starterIds = selectedIds.slice(0, 5);
  const substituteIds = allowSubstitutes ? selectedIds.slice(5, 7) : [];

  const memberMap = new Map(members.map((m) => [m.id, m]));

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= (allowSubstitutes ? 7 : 5)) return prev;
      return [...prev, id];
    });
  }

  function moveStarterUp(index: number) {
    if (index <= 0) return;
    setSelectedIds((prev) => {
      const next = [...prev];
      [next[index], next[index - 1]] = [next[index - 1], next[index]];
      return next;
    });
  }

  function moveStarterDown(index: number) {
    if (index >= starterIds.length - 1) return;
    setSelectedIds((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function handleSave() {
    if (starterIds.length !== 5) {
      toast.error("必须选择 5 名首发");
      return;
    }
    setPendingLineup({ starterIds, substituteIds });
  }

  function executeSave() {
    if (!pendingLineup) return;
    startTransition(async () => {
      const result = await adminSelectMatchRoster(
        matchId,
        teamId,
        { starterIds: pendingLineup.starterIds, substituteIds: allowSubstitutes ? pendingLineup.substituteIds : [] },
      );
      setPendingLineup(null);
      if (result.success) {
        toast.success(`${teamName} 名单已保存，开赛前需另行确认`);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleConfirm(rosterId: string) {
    startTransition(async () => {
      const result = await confirmMatchRoster(rosterId);
      if (result.success) {
        toast.success(result.data.alreadyConfirmed ? `${teamName} 名单此前已确认` : `${teamName} 名单已确认，可以开始比赛`);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-[var(--color-fg)]">{teamName}</h4>
      {existingRoster && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-[var(--color-fg-mid)] flex-1">
            当前名单：{existingRoster.starters.length} 首发
            {allowSubstitutes && existingRoster.substitutes.length > 0
              ? ` + ${existingRoster.substitutes.length} 替补`
              : ""}
            {existingRoster.status && ` · ${STATUS_LABELS[existingRoster.status] ?? existingRoster.status}`}
          </p>
          {existingRoster.rosterId && existingRoster.status !== "confirmed" && (
            <Button size="sm" variant="secondary" onClick={() => handleConfirm(existingRoster.rosterId!)} disabled={isPending}>
              确认名单
            </Button>
          )}
        </div>
      )}

      {/* Explicit review before any admin selection is recorded */}
      {pendingLineup ? (
        <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3 bg-[var(--color-panel-low)]">
          <p className="text-sm font-medium text-[var(--color-fg)]">请核对将保存的首发五人：</p>
          <ol className="space-y-1">
            {pendingLineup.starterIds.map((id, index) => (
              <li key={id} className="text-sm text-[var(--color-fg)]">
                首发 {index + 1}. {memberMap.get(id) ? getDisplayName(memberMap.get(id)!) : "未知队员"}
              </li>
            ))}
          </ol>
          {pendingLineup.substituteIds.length > 0 && (
            <p className="text-xs text-[var(--color-fg-mid)]">
              替补：{pendingLineup.substituteIds.map((id) => (memberMap.get(id) ? getDisplayName(memberMap.get(id)!) : "")).join("、")}
            </p>
          )}
          <p className="text-xs text-[var(--color-fg-mid)]">
            保存后仍需点击「确认名单」，否则该场比赛无法开始。
          </p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={executeSave} disabled={isPending}>
              {isPending ? "保存中..." : "确认保存"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingLineup(null)} disabled={isPending}>
              返回修改
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Player checkboxes */}
          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
            {members.map((m) => {
              const isSelected = selectedIds.includes(m.id);
              const selectedIndex = selectedIds.indexOf(m.id);
              const label =
                isSelected && selectedIndex < 5
                  ? `首发 ${selectedIndex + 1}`
                  : isSelected && allowSubstitutes
                    ? "替补"
                    : null;
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[var(--color-accent)]/10"
                      : "hover:bg-[var(--color-panel-low)]"
                  } ${!isSelected && selectedIds.length >= (allowSubstitutes ? 7 : 5) ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <Checkbox
                    checked={isSelected}
                    disabled={!isSelected && selectedIds.length >= (allowSubstitutes ? 7 : 5)}
                    onChange={() => toggleMember(m.id)}
                  />
                  <span className="text-sm flex-1 truncate">
                    {getDisplayName(m)}
                  </span>
                  <span className="text-xs text-[var(--color-fg-mid)]">
                    {m.primaryPosition}
                  </span>
                  {label && (
                    <span className="text-xs text-[var(--color-accent)] font-medium ml-1">
                      {label}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Starter order controls */}
          {starterIds.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">
                首发顺序（点击箭头调整）
              </Label>
              <div className="space-y-0.5">
                {starterIds.map((id, index) => {
                  const member = memberMap.get(id);
                  if (!member) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-panel-low)]"
                    >
                      <span className="text-xs text-[var(--color-fg-mid)] w-4 tabular-nums">
                        {index + 1}
                      </span>
                      <span className="text-sm flex-1 truncate">
                        {getDisplayName(member)}
                      </span>
                      <span className="text-xs text-[var(--color-fg-mid)]">
                        {member.primaryPosition}
                      </span>
                      <button
                        type="button"
                        onClick={() => moveStarterUp(index)}
                        disabled={index === 0}
                        className="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-accent)]/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStarterDown(index)}
                        disabled={index === starterIds.length - 1}
                        className="text-xs px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-accent)]/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="下移"
                      >
                        ↓
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected count */}
          <p className="text-xs text-[var(--color-fg-mid)]">
            已选 {selectedIds.length}/{allowSubstitutes ? 7 : 5}（首发 {starterIds.length}/5{allowSubstitutes ? `，替补 ${substituteIds.length}/2` : ""}）
          </p>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || starterIds.length !== 5}
          >
            {isPending ? "处理中..." : `核对并保存 ${teamName} 名单`}
          </Button>
        </>
      )}
    </div>
  );
}

// ── AdminRosterDialog ───────────────────────────────────────────────────────

export function AdminRosterDialog({
  matchId,
  teamAName,
  teamBName,
  teamAId,
  teamBId,
  teamAMembers,
  teamBMembers,
  teamARoster,
  teamBRoster,
  allowSubstitutes = true,
}: AdminRosterDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          管理名单
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            名单管理 · {teamAName} vs {teamBName}
          </DialogTitle>
          <DialogDescription>为双方选择并确认本场 5 名首发选手。</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <RosterTeamSection
            teamName={teamAName}
            teamId={teamAId}
            matchId={matchId}
            members={teamAMembers}
            existingRoster={teamARoster}
            allowSubstitutes={allowSubstitutes}
          />
          <Separator />
          <RosterTeamSection
            teamName={teamBName}
            teamId={teamBId}
            matchId={matchId}
            members={teamBMembers}
            existingRoster={teamBRoster}
            allowSubstitutes={allowSubstitutes}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
