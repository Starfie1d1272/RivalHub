"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveVetoSteps, getMatchVetoSteps, type VetoStepInput } from "@/actions/matches/veto";
import { mapLabel } from "@/lib/maps";
import type { VetoActionType } from "@/types/match";
import { SIDE_LABELS } from "@/types/match";
import { cn } from "@/lib/utils/cn";

interface Props {
  matchId: string;
  format: "bo1" | "bo3" | "bo5";
  teamAName: string;
  teamBName: string;
  entryAId: string;
  entryBId: string;
  mapPool: string[];
  matchStatus?: string;
}

interface StepEdit {
  actionType: VetoActionType;
  mapName: string;
  entryId: string | null;
  side: "t" | "ct" | null;
}

const ACTION_LABELS: Record<VetoActionType, string> = {
  ban: "ban",
  pick: "pick",
  side_pick: "选边",
  decider: "decider",
};

function SideSelect({
  label,
  side,
  onSideChange,
}: {
  label: string;
  side: "t" | "ct" | null;
  onSideChange: (side: "t" | "ct" | null) => void;
}) {
  return (
    <>
      <span className="text-[11px] text-[var(--color-fg-mid)] shrink-0">{label}</span>
      <div className="w-20">
        <Select
          value={side ?? "_none"}
          onValueChange={(v) =>
            onSideChange(v === "_none" ? null : (v as "t" | "ct"))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="边" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">未选择</SelectItem>
            <SelectItem value="t">{SIDE_LABELS.t}</SelectItem>
            <SelectItem value="ct">{SIDE_LABELS.ct}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

// ── BP 模板 ─────────────────────────────────────────────────────────────────

function buildTemplate(
  format: "bo1" | "bo3" | "bo5",
  entryAId: string,
  entryBId: string,
): StepEdit[] {
  switch (format) {
    case "bo1":
      // A ban×2, B ban×3, A ban×1 → decider (B picks side)
      return [
        { actionType: "ban", mapName: "", entryId: entryAId, side: null },
        { actionType: "ban", mapName: "", entryId: entryAId, side: null },
        { actionType: "ban", mapName: "", entryId: entryBId, side: null },
        { actionType: "ban", mapName: "", entryId: entryBId, side: null },
        { actionType: "ban", mapName: "", entryId: entryBId, side: null },
        { actionType: "ban", mapName: "", entryId: entryAId, side: null },
        { actionType: "decider", mapName: "", entryId: entryBId, side: null },
      ];
    case "bo3":
      // A ban, B ban, A pick, B pick, B ban, A ban → decider (B picks side)
      return [
        { actionType: "ban", mapName: "", entryId: entryAId, side: null },
        { actionType: "ban", mapName: "", entryId: entryBId, side: null },
        { actionType: "pick", mapName: "", entryId: entryAId, side: null },
        { actionType: "pick", mapName: "", entryId: entryBId, side: null },
        { actionType: "ban", mapName: "", entryId: entryBId, side: null },
        { actionType: "ban", mapName: "", entryId: entryAId, side: null },
        { actionType: "decider", mapName: "", entryId: entryBId, side: null },
      ];
    case "bo5":
      // A ban, B ban → A/B/A/B pick → decider (B picks side)
      return [
        { actionType: "ban", mapName: "", entryId: entryAId, side: null },
        { actionType: "ban", mapName: "", entryId: entryBId, side: null },
        { actionType: "pick", mapName: "", entryId: entryAId, side: null },
        { actionType: "pick", mapName: "", entryId: entryBId, side: null },
        { actionType: "pick", mapName: "", entryId: entryAId, side: null },
        { actionType: "pick", mapName: "", entryId: entryBId, side: null },
        { actionType: "decider", mapName: "", entryId: entryBId, side: null },
      ];
  }
}

export function VetoInputDialog({
  matchId,
  format,
  teamAName,
  teamBName,
  entryAId,
  entryBId,
  mapPool,
  matchStatus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<StepEdit[]>(() =>
    buildTemplate(format, entryAId, entryBId),
  );
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  function teamName(entryId: string | null) {
    if (entryId === entryAId) return teamAName;
    if (entryId === entryBId) return teamBName;
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
    // 所有步骤必须有 teamId（decider 可以没有，但指定了 side 时必须有）
    if (steps.some((s) => s.actionType !== "decider" && !s.entryId)) return false;
    if (steps.some((s) => s.actionType === "decider" && s.side && !s.entryId)) return false;
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
        entryId: s.entryId,
        side: s.side,
      }));
      const result = await saveVetoSteps(matchId, { steps: inputs });
      if (result.success) {
        toast.success("BP 已保存");
        setOpen(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  async function handleOpenChange(next: boolean) {
    if (next) {
      setLoading(true);
      setOpen(true);
      try {
        const existing = await getMatchVetoSteps(matchId);
        if (existing.length > 0) {
          setSteps(
            existing.map((s) => ({
              actionType: s.actionType as VetoActionType,
              mapName: s.mapName,
              entryId: s.entryId,
              side: s.side as "t" | "ct" | null,
            })),
          );
        } else {
          setSteps(buildTemplate(format, entryAId, entryBId));
        }
      } catch {
        setSteps(buildTemplate(format, entryAId, entryBId));
      } finally {
        setLoading(false);
      }
    } else {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          录入 BP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            BP 选图 · {teamAName} vs {teamBName}（{format.toUpperCase()}）
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {matchStatus === "finished" && (
            <p className="rounded-md bg-[var(--color-panel-low)] px-3 py-2 text-xs text-[var(--color-fg-mid)]">
              赛后补录：仅更新 BP 步骤，不重建地图记录（已有比分行不受影响）
            </p>
          )}

          {loading ? (
            <p className="py-4 text-sm text-[var(--color-fg-mid)]">加载中…</p>
          ) : null}
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
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => updateStep(i, { entryId: step.entryId === entryAId ? null : entryAId, side: step.entryId === entryAId ? null : step.side })}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded border transition-colors",
                    step.entryId === entryAId
                      ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
                  )}
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => updateStep(i, { entryId: step.entryId === entryBId ? null : entryBId, side: step.entryId === entryBId ? null : step.side })}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded border transition-colors",
                    step.entryId === entryBId
                      ? "bg-[var(--color-accent-b)] text-[var(--color-accent-b-fg)] border-[var(--color-accent-b)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
                  )}
                >
                  B
                </button>
              </div>

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

              {/* 选边（pick: 对手选边；decider: 选中队伍选边）*/}
              {step.actionType === "pick" && step.entryId && (
                <SideSelect
                  label={`→ ${teamName(step.entryId === entryAId ? entryBId : entryAId)}选边`}
                  side={step.side}
                  onSideChange={(side) => updateStep(i, { side })}
                />
              )}
              {step.actionType === "decider" && step.entryId && (
                <SideSelect
                  label="→ 选边"
                  side={step.side}
                  onSideChange={(side) => updateStep(i, { side })}
                />
              )}
            </div>
          ))}
          </div>
        </DialogBody>

        <DialogFooter className="gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSteps(buildTemplate(format, entryAId, entryBId))}
            disabled={isPending}
          >
            重置模板
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? "保存中..." : "保存 BP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
