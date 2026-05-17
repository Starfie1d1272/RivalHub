"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { getDisplayName } from "@/lib/utils/display-name";
import { updateMatchRoster } from "@/actions/matches/roster";

// ── Types ───────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

interface RosterData {
  starters: string[];
  substitutes: string[];
  status: string | null;
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
}

interface RosterTeamSectionProps {
  teamName: string;
  teamId: string;
  matchId: string;
  members: TeamMember[];
  existingRoster: RosterData | null;
}

// ── RosterTeamSection ───────────────────────────────────────────────────────

function RosterTeamSection({
  teamName,
  teamId,
  matchId,
  members,
  existingRoster,
}: RosterTeamSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (existingRoster) {
      return [...existingRoster.starters, ...existingRoster.substitutes];
    }
    return [];
  });

  const starterIds = selectedIds.slice(0, 5);
  const substituteIds = selectedIds.slice(5, 7);

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 7) return prev;
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
    startTransition(async () => {
      const result = await updateMatchRoster(
        matchId,
        teamId,
        starterIds,
        substituteIds,
      );
      if (result.success) {
        toast.success(`${teamName} 名单已更新`);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  const memberMap = new Map(members.map((m) => [m.id, m]));

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-[var(--color-fg)]">{teamName}</h4>
      {existingRoster && (
        <p className="text-xs text-[var(--color-fg-mid)]">
          当前名单：{existingRoster.starters.length} 首发
          {existingRoster.substitutes.length > 0
            ? ` + ${existingRoster.substitutes.length} 替补`
            : ""}
        </p>
      )}

      {/* Player checkboxes */}
      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
        {members.map((m) => {
          const isSelected = selectedIds.includes(m.id);
          const selectedIndex = selectedIds.indexOf(m.id);
          const label =
            isSelected && selectedIndex < 5
              ? `首发 ${selectedIndex + 1}`
              : isSelected
                ? "替补"
                : null;
          return (
            <label
              key={m.id}
              className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${
                isSelected
                  ? "bg-[var(--color-accent)]/10"
                  : "hover:bg-[var(--color-panel-low)]"
              } ${!isSelected && selectedIds.length >= 7 ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <Checkbox
                checked={isSelected}
                disabled={!isSelected && selectedIds.length >= 7}
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
        已选 {selectedIds.length}/7（首发 {starterIds.length}/5，替补{" "}
        {substituteIds.length}/2）
      </p>

      <Button
        size="sm"
        onClick={handleSave}
        disabled={isPending || starterIds.length !== 5}
      >
        {isPending ? "保存中..." : `保存 ${teamName} 名单`}
      </Button>
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
        </DialogHeader>

        <div className="space-y-6">
          <RosterTeamSection
            teamName={teamAName}
            teamId={teamAId}
            matchId={matchId}
            members={teamAMembers}
            existingRoster={teamARoster}
          />
          <Separator />
          <RosterTeamSection
            teamName={teamBName}
            teamId={teamBId}
            matchId={matchId}
            members={teamBMembers}
            existingRoster={teamBRoster}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
