"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { correctMapScore } from "@/actions/matches";
import { mapLabel } from "@/lib/maps";

interface MapScoreCorrectInputProps {
  mapId: string;
  mapName: string;
  scoreA: number;
  scoreB: number;
  teamAName: string;
  teamBName: string;
}

export function MapScoreCorrectInput({
  mapId,
  mapName,
  scoreA,
  scoreB,
  teamAName,
  teamBName,
}: MapScoreCorrectInputProps) {
  const [editing, setEditing] = useState(false);
  const [valA, setValA] = useState(String(scoreA));
  const [valB, setValB] = useState(String(scoreB));
  const [isPending, startTransition] = useTransition();

  function handleEdit() {
    setValA(String(scoreA));
    setValB(String(scoreB));
    setEditing(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const a = parseInt(valA, 10);
    const b = parseInt(valB, 10);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      toast.error("请输入有效的非负整数");
      return;
    }
    if (a === b) {
      toast.error("单图不能平局");
      return;
    }
    startTransition(async () => {
      const result = await correctMapScore(mapId, a, b);
      if (result.success) {
        toast.success(`${mapLabel(mapName)} 比分已修正，大比分已自动更新`);
        setEditing(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      <span className="text-[var(--color-fg-mid)] w-20 shrink-0">{mapLabel(mapName)}</span>
      {!editing ? (
        <>
          <span className="font-mono text-[var(--color-fg)]">
            {scoreA} : {scoreB}
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleEdit}>
            修改
          </Button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-[var(--color-fg-dim)]">{teamAName}</Label>
            <Input
              type="number"
              min="0"
              value={valA}
              onChange={(e) => setValA(e.target.value)}
              className="w-14 text-center h-7 text-xs"
              disabled={isPending}
            />
          </div>
          <span className="text-[var(--color-fg-mid)] pb-1">:</span>
          <div className="space-y-1">
            <Label className="text-[10px] text-[var(--color-fg-dim)]">{teamBName}</Label>
            <Input
              type="number"
              min="0"
              value={valB}
              onChange={(e) => setValB(e.target.value)}
              className="w-14 text-center h-7 text-xs"
              disabled={isPending}
            />
          </div>
          <Button type="submit" size="sm" className="h-7 text-xs" disabled={isPending}>
            确认
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isPending}
            onClick={() => setEditing(false)}
          >
            取消
          </Button>
        </form>
      )}
    </div>
  );
}
