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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveVetoSteps, type VetoStepInput } from "@/actions/matches/veto";
import { mapLabel } from "@/lib/maps";
import type { VetoActionType } from "@/types/match";
import { SIDE_LABELS } from "@/types/match";

interface Props {
  matchId: string;
  format: "bo1" | "bo3" | "bo5";
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  mapPool: string[];
}

interface StepEdit {
  actionType: VetoActionType;
  mapName: string;
  teamId: string | null;
  side: "t" | "ct" | null;
}

const ACTION_LABELS: Record<VetoActionType, string> = {
  ban: "ban",
  pick: "pick",
  side_pick: "选边",
  decider: "decider",
};

// ── BP 模板 ─────────────────────────────────────────────────────────────────

function buildTemplate(
  format: "bo1" | "bo3" | "bo5",
  teamAId: string,
  teamBId: string,
): StepEdit[] {
  switch (format) {
    case "bo1":
      // A ban×2, B ban×3, A ban×1 → decider (B picks side)
      return [
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "ban", mapName: "", teamId: teamBId, side: null },
        { actionType: "ban", mapName: "", teamId: teamBId, side: null },
        { actionType: "ban", mapName: "", teamId: teamBId, side: null },
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "decider", mapName: "", teamId: teamBId, side: null },
      ];
    case "bo3":
      // A ban, B ban, A pick, B pick, B ban, A ban → decider (leftover)
      return [
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "ban", mapName: "", teamId: teamBId, side: null },
        { actionType: "pick", mapName: "", teamId: teamAId, side: null },
        { actionType: "pick", mapName: "", teamId: teamBId, side: null },
        { actionType: "ban", mapName: "", teamId: teamBId, side: null },
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "decider", mapName: "", teamId: null, side: null },
      ];
    case "bo5":
      // A ban×2 → B pick, A pick, B pick, A pick → decider (knife round)
      return [
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "ban", mapName: "", teamId: teamAId, side: null },
        { actionType: "pick", mapName: "", teamId: teamBId, side: null },
        { actionType: "pick", mapName: "", teamId: teamAId, side: null },
        { actionType: "pick", mapName: "", teamId: teamBId, side: null },
        { actionType: "pick", mapName: "", teamId: teamAId, side: null },
        { actionType: "decider", mapName: "", teamId: null, side: null },
      ];
  }
}

export function VetoInputDialog({
  matchId,
  format,
  teamAName,
  teamBName,
  teamAId,
  teamBId,
  mapPool,
}: Props) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<StepEdit[]>(() =>
    buildTemplate(format, teamAId, teamBId),
  );
  const [isPending, startTransition] = useTransition();

  function teamName(teamId: string | null) {
    if (teamId === teamAId) return teamAName;
    if (teamId === teamBId) return teamBName;
    return "—";
  }

  function updateStep(index: number, update: Partial<StepEdit>) {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next;
    });
  }

  // 已用于 ban/pick/decider 的地图
  const usedMaps = new Set(steps.map((s) => s.mapName).filter(Boolean));

  function availableMaps(index: number): string[] {
    const currentMap = steps[index]?.mapName;
    return mapPool.filter((m) => m === currentMap || !usedMaps.has(m));
  }

  function isValid(): boolean {
    // 所有步骤必须填满地图
    if (steps.some((s) => !s.mapName)) return false;
    // 所有步骤必须有 teamId（decider 可以没有）
    if (steps.some((s) => s.actionType !== "decider" && !s.teamId)) return false;
    // 无重复地图
    const maps = steps.map((s) => s.mapName);
    if (new Set(maps).size !== maps.length) return false;
    return true;
  }

  function handleSave() {
    if (!isValid()) {
      toast.error("请完整填写所有 BP 步骤，且地图不能重复");
      return;
    }
    startTransition(async () => {
      const inputs: VetoStepInput[] = steps.map((s) => ({
        actionType: s.actionType,
        mapName: s.mapName,
        teamId: s.teamId,
        side: s.side,
      }));
      const result = await saveVetoSteps(matchId, inputs);
      if (result.success) {
        toast.success("BP 已保存");
        setOpen(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      // 每次打开对话框时重置为模板
      setSteps(buildTemplate(format, teamAId, teamBId));
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          录入 BP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            BP 选图 · {teamAName} vs {teamBName}（{format.toUpperCase()}）
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-md border border-[var(--color-border)]"
            >
              {/* 序号 */}
              <span className="text-sm text-[var(--color-fg-mid)] w-6 text-right tabular-nums">
                {i + 1}
              </span>

              {/* 操作类型 */}
              <span className="text-xs font-mono uppercase w-16 text-center px-1.5 py-0.5 rounded-sm bg-[var(--color-panel-low)] text-[var(--color-fg-mid)]">
                {ACTION_LABELS[step.actionType]}
              </span>

              {/* 执行队伍 */}
              {step.actionType === "decider" && step.teamId === null ? (
                <span className="text-sm text-[var(--color-fg-mid)] w-24">
                  刀赛/剩余
                </span>
              ) : (
                <div className="w-24">
                  <Select
                    value={step.teamId ?? ""}
                    onValueChange={(v) => updateStep(i, { teamId: v || null })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="选择队伍" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={teamAId}>{teamAName}</SelectItem>
                      <SelectItem value={teamBId}>{teamBName}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 地图 */}
              <div className="flex-1">
                <Select
                  value={step.mapName}
                  onValueChange={(v) => updateStep(i, { mapName: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="选择地图" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMaps(i).map((m) => (
                      <SelectItem key={m} value={m}>
                        {mapLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 选边（仅 pick / decider 显示）*/}
              {(step.actionType === "pick" || step.actionType === "decider") && (
                <div className="w-20">
                  <Select
                    value={step.side ?? "_none"}
                    onValueChange={(v) =>
                      updateStep(i, {
                        side: v === "_none" ? null : (v as "t" | "ct"),
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="边" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">自动</SelectItem>
                      <SelectItem value="t">{SIDE_LABELS.t}</SelectItem>
                      <SelectItem value="ct">{SIDE_LABELS.ct}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSteps(buildTemplate(format, teamAId, teamBId))}
            disabled={isPending}
          >
            重置模板
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? "保存中..." : "保存 BP"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
