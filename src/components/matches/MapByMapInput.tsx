"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { recordMapResult } from "@/actions/matches";

const CS2_MAP_POOL = [
  "de_mirage", "de_inferno", "de_nuke", "de_ancient",
  "de_dust2", "de_anubis", "de_train",
];

interface CompletedMap {
  mapOrder: number;
  mapName: string;
  scoreA: number;
  scoreB: number;
  pickedByTeamId: string | null;
  teamAStartSide: "t" | "ct" | null;
}

interface MapByMapInputProps {
  matchId: string;
  format: "bo3" | "bo5";
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  completedMaps: CompletedMap[];
}

const SIDE_LABELS = { t: "T 方", ct: "CT 方" };

export function MapByMapInput({
  matchId, format, teamAName, teamBName, teamAId, teamBId, completedMaps,
}: MapByMapInputProps) {
  const maxWins = format === "bo3" ? 2 : 3;
  const maxMaps = format === "bo3" ? 3 : 5;

  let mapWinsA = 0;
  let mapWinsB = 0;
  for (const m of completedMaps) {
    if (m.scoreA > m.scoreB) mapWinsA++;
    else mapWinsB++;
  }

  const seriesFinished = mapWinsA >= maxWins || mapWinsB >= maxWins;
  const nextMapOrder = completedMaps.length + 1;
  const usedMapNames = new Set(completedMaps.map((m) => m.mapName));
  const availableMaps = CS2_MAP_POOL.filter((m) => !usedMapNames.has(m));

  const [mapName, setMapName] = useState("");
  const [pickedBy, setPickedBy] = useState<string>("decider"); // teamAId | teamBId | "decider"
  const [teamAStartSide, setTeamAStartSide] = useState<string>("none"); // "t" | "ct" | "none"
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mapName) { toast.error("请选择地图"); return; }
    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) { toast.error("请输入有效的非负整数"); return; }
    if (a === b) { toast.error("单图不能平局"); return; }

    const pickedByTeamId = pickedBy === "decider" ? null : pickedBy;
    const side = teamAStartSide === "none" ? null : teamAStartSide as "t" | "ct";

    startTransition(async () => {
      const result = await recordMapResult(matchId, nextMapOrder, mapName, a, b, pickedByTeamId, side);
      if (result.success) {
        toast.success(result.data.seriesFinished ? "系列赛结束，大比分已自动更新" : `第 ${nextMapOrder} 图已录入`);
        setMapName("");
        setPickedBy("decider");
        setTeamAStartSide("none");
        setScoreA("");
        setScoreB("");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* 系列赛进度 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--color-fg-mid)]">{format.toUpperCase()} 进度</span>
        <span className="font-mono font-bold text-[var(--primary)]">{mapWinsA} : {mapWinsB}</span>
        <span className="text-xs text-[var(--color-fg-mid)]">（先赢 {maxWins} 图胜）</span>
      </div>

      {/* 已完成的图 */}
      {completedMaps.length > 0 && (
        <div className="space-y-1">
          {completedMaps.map((m) => {
            const pickedByName = m.pickedByTeamId === teamAId ? teamAName
              : m.pickedByTeamId === teamBId ? teamBName : null;
            return (
              <div key={m.mapOrder} className="flex items-center gap-2 text-xs text-[var(--color-fg-mid)]">
                <span className="w-4">#{m.mapOrder}</span>
                <span className="font-medium text-[var(--color-fg)]">{m.mapName}</span>
                {pickedByName
                  ? <Badge variant="outline" className="text-xs">{pickedByName} pick</Badge>
                  : <Badge variant="outline" className="text-xs text-[var(--color-fg-dim)]">决胜图</Badge>}
                {m.teamAStartSide && (
                  <span>{teamAName} {SIDE_LABELS[m.teamAStartSide]}先</span>
                )}
                <Badge variant="outline" className="text-xs font-mono">{m.scoreA} : {m.scoreB}</Badge>
                <span>{m.scoreA > m.scoreB ? teamAName : teamBName} 胜</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 录入下一图 */}
      {!seriesFinished && nextMapOrder <= maxMaps && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-1 border-t border-[var(--color-border)]">
          <p className="text-xs font-medium text-[var(--color-fg-mid)] pt-2">录入第 {nextMapOrder} 图</p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">地图</Label>
              <Select value={mapName} onValueChange={setMapName}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  {availableMaps.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">Pick 方</Label>
              <Select value={pickedBy} onValueChange={setPickedBy}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={teamAId} className="text-xs">{teamAName}</SelectItem>
                  <SelectItem value={teamBId} className="text-xs">{teamBName}</SelectItem>
                  <SelectItem value="decider" className="text-xs">决胜图</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">{teamAName} 起始边</Label>
              <Select value={teamAStartSide} onValueChange={setTeamAStartSide}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="t" className="text-xs">T 方</SelectItem>
                  <SelectItem value="ct" className="text-xs">CT 方</SelectItem>
                  <SelectItem value="none" className="text-xs">不填</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-2 sm:col-span-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">回合数</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min="0" value={scoreA} onChange={(e) => setScoreA(e.target.value)}
                  className="w-14 text-center h-8 text-xs" placeholder="0" />
                <span className="text-[var(--color-fg-mid)] text-xs">:</span>
                <Input type="number" min="0" value={scoreB} onChange={(e) => setScoreB(e.target.value)}
                  className="w-14 text-center h-8 text-xs" placeholder="0" />
              </div>
            </div>
          </div>

          <Button type="submit" size="sm" disabled={isPending} className="h-8 text-xs">
            确认录入
          </Button>
        </form>
      )}

      {seriesFinished && (
        <p className="text-xs text-green-600 font-medium">
          系列赛结束：{mapWinsA > mapWinsB ? teamAName : teamBName} 胜 {Math.max(mapWinsA, mapWinsB)}:{Math.min(mapWinsA, mapWinsB)}
        </p>
      )}
    </div>
  );
}
