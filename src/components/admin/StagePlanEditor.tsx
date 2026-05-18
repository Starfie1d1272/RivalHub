"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STAGE_TYPE_LABELS,
  MAJOR_STAGE_PLAN,
  RIVALS_STAGE_PLAN,
  type StageConfig,
  type StagePlan,
  type StageType,
} from "@/types/season";

const STAGE_TYPES: StageType[] = ["round_robin", "single_elim", "double_elim", "swiss", "gsl_group"];
const MATCH_FORMATS = ["bo1", "bo3", "bo5"] as const;

interface StagePlanEditorProps {
  value: StagePlan;
  onChange: (plan: StagePlan) => void;
}

function stageNameToKey(name: string): string {
  if (!name) return "";
  const map: Record<string, string> = {
    "瑞士轮": "swiss", "淘汰赛": "knockout", "排位赛": "ranking",
    "单循环": "round_robin", "双败": "double_elim", "单败": "single_elim",
    "小组赛": "groups", "决赛": "final",
  };
  for (const [cn, key] of Object.entries(map)) {
    if (name.includes(cn)) return key;
  }
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase().slice(0, 20) || "stage";
}

function emptyStage(): StageConfig {
  return {
    key: "",
    name: "",
    type: "swiss",
    teamCount: 16,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo1",
    groupCount: 1,
    hasThirdPlaceMatch: false,
  };
}

function updateStage(stages: StagePlan, index: number, patch: Partial<StageConfig>): StagePlan {
  return stages.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function StagePlanEditor({ value, onChange }: StagePlanEditorProps) {
  function addStage() {
    onChange([...value, emptyStage()]);
  }

  function removeStage(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function applyPreset(preset: "major" | "rivals" | "clear") {
    if (preset === "clear") {
      onChange([]);
      return;
    }
    if (!confirm("当前赛制配置将被覆盖，是否继续？")) return;
    const plan = preset === "major" ? MAJOR_STAGE_PLAN : RIVALS_STAGE_PLAN;
    onChange(structuredClone(plan));
  }

  return (
    <div className="space-y-4">
      {value.map((stage, index) => (
        <Card key={index} className="p-4 space-y-3 relative">
          <button
            type="button"
            className="absolute top-2 right-2 text-xs text-destructive hover:underline"
            onClick={() => removeStage(index)}
          >
            删除阶段
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>阶段名称</Label>
              <Input
                value={stage.name}
                onChange={(e) => {
                  const name = e.target.value;
                  const key = stage.key || stageNameToKey(name);
                  onChange(updateStage(value, index, { name, key }));
                }}
                placeholder="例如：瑞士轮阶段"
              />
            </div>
            <div>
              <Label>阶段标识 (key)</Label>
              <Input
                value={stage.key}
                onChange={(e) => onChange(updateStage(value, index, { key: e.target.value }))}
                placeholder="英文标识"
              />
            </div>
            <div>
              <Label>赛制类型</Label>
              <Select
                value={stage.type}
                onValueChange={(v) => onChange(updateStage(value, index, { type: v as StageType }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{STAGE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>队伍数</Label>
              <Input
                type="number" min={2} max={128}
                value={stage.teamCount}
                onChange={(e) => onChange(updateStage(value, index, { teamCount: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>比赛 BO</Label>
              <Select
                value={stage.matchFormat ?? "bo1"}
                onValueChange={(v) => onChange(updateStage(value, index, { matchFormat: v as "bo1" | "bo3" | "bo5" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATCH_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* advanceTiers hidden for double_elim — qualifiers are bracket-determined */}
            {stage.type !== "double_elim" && (
            <div>
              <Label>晋级规则</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={stage.advanceTiers[0]?.placement ?? "*"}
                  onValueChange={(placement) => onChange(updateStage(value, index, {
                    advanceTiers: [{ placement, count: stage.advanceTiers[0]?.count ?? 1 }],
                  }))}
                >
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="*">全部晋级</SelectItem>
                    <SelectItem value="1st">冠军</SelectItem>
                    <SelectItem value="2nd">亚军</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-[var(--color-fg-mid)]">取前</span>
                <Input
                  type="number" min={1}
                  className="w-20"
                  value={stage.advanceTiers[0]?.count ?? 1}
                  onChange={(e) => onChange(updateStage(value, index, {
                    advanceTiers: [{ ...stage.advanceTiers[0], placement: stage.advanceTiers[0]?.placement ?? "*", count: Number(e.target.value) }],
                  }))}
                />
                <span className="text-sm text-[var(--color-fg-mid)]">名</span>
              </div>
            </div>
            )}
          </div>

          {/* Dynamic fields by type */}
          {(stage.type === "swiss" || stage.type === "round_robin" || stage.type === "gsl_group") && (
            <div>
              <Label>分组数</Label>
              <Input
                type="number" min={1} max={16}
                className="w-24"
                value={stage.groupCount ?? 1}
                onChange={(e) => onChange(updateStage(value, index, { groupCount: Number(e.target.value) }))}
              />
            </div>
          )}

          {(stage.type === "single_elim" || stage.type === "double_elim") && (
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={stage.hasThirdPlaceMatch ?? false}
                  onChange={(e) => onChange(updateStage(value, index, { hasThirdPlaceMatch: e.target.checked }))}
                />
                三四名决赛
              </label>
              <div>
                <Label>决赛 BO 覆写</Label>
                <Select
                  value={stage.finalFormat ?? "__none__"}
                  onValueChange={(v) => onChange(updateStage(value, index, {
                    finalFormat: v === "__none__" ? undefined : (v as "bo3" | "bo5"),
                  }))}
                >
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不覆写</SelectItem>
                    <SelectItem value="bo3">BO3</SelectItem>
                    <SelectItem value="bo5">BO5</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addStage}>
          添加阶段
        </Button>
        <Select onValueChange={(v) => v !== "__none__" && applyPreset(v as "major" | "rivals" | "clear")}>
          <SelectTrigger className="w-44"><SelectValue placeholder="预设赛制..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="major">Major 32队</SelectItem>
            <SelectItem value="rivals">Rivals 8队</SelectItem>
            <SelectItem value="clear">空赛制</SelectItem>
            <SelectItem value="__none__">自定义</SelectItem>
          </SelectContent>
        </Select>
        {value.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => applyPreset("clear")}>
            清空阶段
          </Button>
        )}
      </div>
    </div>
  );
}
