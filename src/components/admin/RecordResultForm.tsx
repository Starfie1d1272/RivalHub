"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordMatchResult } from "@/actions/matches";

const FORMAT_MAX: Record<string, number> = { bo1: 1, bo3: 3, bo5: 5 };

const CS2_MAPS = [
  "de_mirage",
  "de_inferno",
  "de_nuke",
  "de_ancient",
  "de_anubis",
  "de_dust2",
  "de_vertigo",
];

interface TeamOption {
  id: string;
  name: string;
}

interface RecordResultFormProps {
  matchId: string;
  format: string;
  teamA: TeamOption;
  teamB: TeamOption;
  onSuccess: () => void;
}

interface MapEntry {
  mapName: string;
  pickedByTeamId: string | null;
  teamAStartSide: "t" | "ct" | null;
  scoreA: string;
  scoreB: string;
}

function emptyMap(): MapEntry {
  return { mapName: "", pickedByTeamId: null, teamAStartSide: null, scoreA: "", scoreB: "" };
}

export function RecordResultForm({
  matchId,
  format,
  teamA,
  teamB,
  onSuccess,
}: RecordResultFormProps) {
  const [isPending, startTransition] = useTransition();
  const maxMaps = FORMAT_MAX[format] ?? 1;
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [mapEntries, setMapEntries] = useState<MapEntry[]>([emptyMap()]);

  function updateMap(i: number, patch: Partial<MapEntry>) {
    setMapEntries((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function addMap() {
    if (mapEntries.length < maxMaps) setMapEntries((prev) => [...prev, emptyMap()]);
  }

  function removeMap(i: number) {
    if (mapEntries.length > 1) setMapEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sA = parseInt(scoreA, 10);
    const sB = parseInt(scoreB, 10);
    if (isNaN(sA) || isNaN(sB) || sA < 0 || sB < 0) {
      toast.error("请输入有效的系列赛比分");
      return;
    }

    const maps: {
      mapOrder: number;
      mapName: string;
      pickedByTeamId: string | null;
      teamAStartSide: "t" | "ct" | null;
      scoreA: number;
      scoreB: number;
    }[] = [];
    for (const [i, m] of mapEntries.entries()) {
      const mA = parseInt(m.scoreA, 10);
      const mB = parseInt(m.scoreB, 10);
      if (isNaN(mA) || isNaN(mB) || mA < 0 || mB < 0) {
        toast.error(`第 ${i + 1} 张图比分不完整`);
        return;
      }
      if (!m.mapName) {
        toast.error(`第 ${i + 1} 张图请选择地图`);
        return;
      }
      maps.push({
        mapOrder: i + 1,
        mapName: m.mapName,
        pickedByTeamId: m.pickedByTeamId,
        teamAStartSide: m.teamAStartSide,
        scoreA: mA,
        scoreB: mB,
      });
    }

    startTransition(async () => {
      const result = await recordMatchResult({ matchId, scoreA: sA, scoreB: sB, maps });
      if (result.success) {
        toast.success("比赛结果已录入");
        onSuccess();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 系列赛总比分 */}
      <div>
        <Label className="block mb-2">系列赛比分</Label>
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">{teamA.name}</p>
            <Input
              type="number"
              min={0}
              value={scoreA}
              onChange={(e) => setScoreA(e.target.value)}
              placeholder="0"
              className="text-center"
            />
          </div>
          <span className="text-[var(--text-muted)] text-lg">:</span>
          <div className="flex-1 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">{teamB.name}</p>
            <Input
              type="number"
              min={0}
              value={scoreB}
              onChange={(e) => setScoreB(e.target.value)}
              placeholder="0"
              className="text-center"
            />
          </div>
        </div>
      </div>

      {/* 各图结果 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>地图结果</Label>
          {mapEntries.length < maxMaps && (
            <Button type="button" variant="outline" size="sm" onClick={addMap}>
              + 添加地图
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {mapEntries.map((m, i) => (
            <div
              key={i}
              className="border border-[var(--border)] rounded-lg p-4 space-y-3 bg-[var(--bg-overlay)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-secondary)]">
                  第 {i + 1} 张图
                </span>
                {mapEntries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMap(i)}
                    className="text-xs text-[var(--text-muted)] hover:text-red-400"
                  >
                    移除
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">地图</Label>
                  <Select value={m.mapName} onValueChange={(v) => updateMap(i, { mapName: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择地图" />
                    </SelectTrigger>
                    <SelectContent>
                      {CS2_MAPS.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Pick 方</Label>
                  <Select
                    value={m.pickedByTeamId ?? "__decider__"}
                    onValueChange={(v) =>
                      updateMap(i, { pickedByTeamId: v === "__decider__" ? null : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择 pick 方" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={teamA.id}>{teamA.name}</SelectItem>
                      <SelectItem value={teamB.id}>{teamB.name}</SelectItem>
                      <SelectItem value="__decider__">决胜图</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{teamA.name} 起始边</Label>
                  <Select
                    value={m.teamAStartSide ?? ""}
                    onValueChange={(v) =>
                      updateMap(i, { teamAStartSide: v as "t" | "ct" | null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="t">T</SelectItem>
                      <SelectItem value="ct">CT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{teamA.name}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={m.scoreA}
                      onChange={(e) => updateMap(i, { scoreA: e.target.value })}
                      placeholder="0"
                      className="text-center"
                    />
                  </div>
                  <span className="text-[var(--text-muted)] pb-2">:</span>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{teamB.name}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={m.scoreB}
                      onChange={(e) => updateMap(i, { scoreB: e.target.value })}
                      placeholder="0"
                      className="text-center"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending || !scoreA || !scoreB}>
          {isPending ? "保存中..." : "保存结果"}
        </Button>
      </div>
    </form>
  );
}
