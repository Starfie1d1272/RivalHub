"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineConfirm } from "@/components/rivalhub";
import { recordMatchResult, updateMatchStatus, correctMatchScore } from "@/actions/matches";

interface ScoreInputProps {
  matchId: string;
  teamAName: string;
  teamBName: string;
  currentStatus: "scheduled" | "in_progress" | "finished" | "cancelled";
  format: "bo1" | "bo3" | "bo5";
  currentScoreA?: number | null;
  currentScoreB?: number | null;
  startBlockers?: string[];
}

const MAX_WINS: Record<string, number | null> = { bo1: null, bo3: 2, bo5: 3 };
const SCORE_LABELS: Record<string, string> = { bo1: "回合数", bo3: "系列赛比分（地图胜场）", bo5: "系列赛比分（地图胜场）" };

function validateSeriesScore(format: string, a: number, b: number): string | null {
  if (isNaN(a) || isNaN(b) || a < 0 || b < 0) return "请输入有效的非负整数";
  if (a === b) return "系列赛不能平局";
  const maxWins = MAX_WINS[format];
  if (maxWins !== null) {
    const winner = Math.max(a, b);
    const loser = Math.min(a, b);
    if (winner !== maxWins || loser >= maxWins) {
      return `${format.toUpperCase()} 比分不合法（胜者须恰好赢 ${maxWins} 图，如 ${maxWins}:0 或 ${maxWins}:${maxWins - 1}）`;
    }
  }
  return null;
}

export function ScoreInput({ matchId, teamAName, teamBName, currentStatus, format, currentScoreA, currentScoreB, startBlockers = [] }: ScoreInputProps) {
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showCorrect, setShowCorrect] = useState(false);
  const [correctA, setCorrectA] = useState("");
  const [correctB, setCorrectB] = useState("");
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
    const err = validateSeriesScore(format, a, b);
    if (err) {
      toast.error(err);
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

  function handleCorrect(e: React.FormEvent) {
    e.preventDefault();
    const a = parseInt(correctA, 10);
    const b = parseInt(correctB, 10);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      toast.error("请输入有效的非负整数");
      return;
    }
    if (a === b) {
      toast.error("系列赛不能平局");
      return;
    }
    startTransition(async () => {
      const result = await correctMatchScore(matchId, a, b);
      if (result.success) {
        toast.success("比分已修正");
        setShowCorrect(false);
        setCorrectA("");
        setCorrectB("");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  if (currentStatus === "finished") {
    return (
      <div className="space-y-2">
        {!showCorrect ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCorrectA(currentScoreA != null ? String(currentScoreA) : "");
              setCorrectB(currentScoreB != null ? String(currentScoreB) : "");
              setShowCorrect(true);
            }}
          >
            修改比分
          </Button>
        ) : (
          <form onSubmit={handleCorrect} className="space-y-3">
            <p className="text-xs text-[var(--color-fg-mid)]">
              {format === "bo1" ? "回合数（MR12：13 / 16 / 19 / 22）" : SCORE_LABELS[format]}
            </p>
            <p className="text-xs text-[var(--color-accent)]">仅修正比分数字，不影响胜负判定和晋级结果</p>
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-[var(--color-fg-mid)]">{teamAName}</Label>
                <Input
                  type="number"
                  min="0"
                  value={correctA}
                  onChange={(e) => setCorrectA(e.target.value)}
                  className="w-20 text-center"
                  placeholder="0"
                />
              </div>
              <span className="text-[var(--color-fg-mid)] mb-2">:</span>
              <div className="space-y-1">
                <Label className="text-xs text-[var(--color-fg-mid)]">{teamBName}</Label>
                <Input
                  type="number"
                  min="0"
                  value={correctB}
                  onChange={(e) => setCorrectB(e.target.value)}
                  className="w-20 text-center"
                  placeholder="0"
                />
              </div>
              <Button type="submit" size="sm" disabled={isPending} className="mb-0.5">
                确认修改
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                className="mb-0.5"
                onClick={() => setShowCorrect(false)}
              >
                取消
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (currentStatus === "cancelled") {
    return null;
  }

  return (
    <div className="space-y-3">
      {currentStatus === "scheduled" && (
        <div className="space-y-3">
          {showStartConfirm ? (
            <InlineConfirm
              title="确认开始比赛？"
              sub="开始后比赛状态将变为「进行中」"
              onConfirm={handleStart}
              onCancel={() => setShowStartConfirm(false)}
            />
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setShowStartConfirm(true)} disabled={isPending || startBlockers.length > 0}>
                开始比赛
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={isPending}>
                取消比赛
              </Button>
            </div>
          )}
          {startBlockers.length > 0 && <p className="text-xs leading-5 text-[var(--color-warn)]">无法开始：{startBlockers.join("；")}</p>}
        </div>
      )}

      {currentStatus === "in_progress" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-xs text-[var(--color-fg-mid)]">{SCORE_LABELS[format]}</p>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">{teamAName}</Label>
              <Input
                type="number"
                min="0"
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                className="w-20 text-center"
                placeholder="0"
              />
            </div>
            <span className="text-[var(--color-fg-mid)] mb-2">:</span>
            <div className="space-y-1">
              <Label className="text-xs text-[var(--color-fg-mid)]">{teamBName}</Label>
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
