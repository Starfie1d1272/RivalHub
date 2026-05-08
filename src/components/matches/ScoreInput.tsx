"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordMatchResult, updateMatchStatus } from "@/actions/matches";

interface ScoreInputProps {
  matchId: string;
  teamAName: string;
  teamBName: string;
  currentStatus: "scheduled" | "in_progress" | "finished" | "cancelled";
  /** BO1 排位赛：输入实际回合数（如 13:8）；BO3/BO5：输入系列赛图数（如 2:1） */
  isBO1?: boolean;
}

export function ScoreInput({ matchId, teamAName, teamBName, currentStatus, isBO1 = false }: ScoreInputProps) {
  const scoreLabel = isBO1 ? "回合数" : "系列赛比分";
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const result = await updateMatchStatus(matchId, "in_progress");
      if (result.success) {
        toast.success("比赛已开始");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      toast.error("请输入有效的非负整数比分");
      return;
    }
    if (a === b) {
      toast.error("系列赛不能平局");
      return;
    }
    startTransition(async () => {
      const result = await recordMatchResult(matchId, a, b);
      if (result.success) {
        toast.success("比分已录入");
        setScoreA("");
        setScoreB("");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await updateMatchStatus(matchId, "cancelled");
      if (result.success) {
        toast.success("比赛已取消");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  if (currentStatus === "finished" || currentStatus === "cancelled") {
    return null;
  }

  return (
    <div className="space-y-3">
      {currentStatus === "scheduled" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleStart} disabled={isPending}>
            开始比赛
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel} disabled={isPending}>
            取消比赛
          </Button>
        </div>
      )}

      {currentStatus === "in_progress" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">{scoreLabel}</p>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-[var(--text-secondary)]">{teamAName}</Label>
              <Input
                type="number"
                min="0"
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                className="w-20 text-center"
                placeholder="0"
              />
            </div>
            <span className="text-[var(--text-secondary)] mb-2">:</span>
            <div className="space-y-1">
              <Label className="text-xs text-[var(--text-secondary)]">{teamBName}</Label>
              <Input
                type="number"
                min="0"
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
                className="w-20 text-center"
                placeholder="0"
              />
            </div>
            <Button type="submit" size="sm" disabled={isPending} className="mb-0.5">
              录入结果
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={isPending}
          >
            取消比赛
          </Button>
        </form>
      )}
    </div>
  );
}
