"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyMatchResultCorrection,
  planMatchResultCorrection,
  recordMatchRecoveryAdjudication,
} from "@/actions/matches/corrections";

interface CorrectionPlan {
  current: { scoreA: number | null; scoreB: number | null; isForfeit: boolean };
  proposed: { scoreA: number; scoreB: number; isForfeit: boolean };
  winnerChanges: boolean;
  affectsManagedRun: boolean;
  impacts: {
    kind: string;
    matchId?: string;
    managedKey?: string | null;
    status: string;
    description: string;
  }[];
  blockedReasons: string[];
  requiredRecoveryActions: string[];
}

interface ResultCorrectionPanelProps {
  matchId: string;
  teamAName: string;
  teamBName: string;
  format: "bo1" | "bo3" | "bo5";
}

/**
 * G2 admin recovery UI for finished matches:
 * propose → review downstream impact / blocked reasons → explicit confirm.
 */
export function ResultCorrectionPanel({
  matchId,
  teamAName,
  teamBName,
  format,
}: ResultCorrectionPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scoreA, setScoreA] = useState<string>("");
  const [scoreB, setScoreB] = useState<string>("");
  const [isForfeit, setIsForfeit] = useState(false);
  const [plan, setPlan] = useState<CorrectionPlan | null>(null);
  const [adjudicationNote, setAdjudicationNote] = useState("");

  function parseScores(): { scoreA: number; scoreB: number } | null {
    const a = Number(scoreA);
    const b = Number(scoreB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) {
      toast.error("请输入合法且能分出胜负的整数比分");
      return null;
    }
    return { scoreA: a, scoreB: b };
  }

  function handlePlan() {
    const scores = parseScores();
    if (!scores) return;
    startTransition(async () => {
      const result = await planMatchResultCorrection(matchId, {
        ...scores,
        isForfeit,
      });
      if (result.success) {
        setPlan(result.data as CorrectionPlan);
        router.refresh();
      } else {
        setPlan(null);
        toast.error(result.error.message);
      }
    });
  }

  function handleApply(confirmedRecovery: boolean) {
    const scores = parseScores();
    if (!scores || !plan) return;
    startTransition(async () => {
      const result = await applyMatchResultCorrection(matchId, {
        ...scores,
        isForfeit,
        confirmRecovery: confirmedRecovery,
      });
      if (result.success) {
        toast.success(
          result.data.alreadyApplied
            ? "该结果已是目标状态（幂等，无变更）"
            : result.data.winnerChanged
              ? `更正已应用；作废 ${result.data.invalidatedCount} 场未开始下游比赛，请按提示重新确认轮次`
              : "比分已更正",
        );
        setPlan(null);
        setScoreA("");
        setScoreB("");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleAdjudicate() {
    if (!adjudicationNote.trim()) {
      toast.error("裁决说明不能为空");
      return;
    }
    startTransition(async () => {
      const result = await recordMatchRecoveryAdjudication(matchId, adjudicationNote);
      if (result.success) {
        toast.success("裁决记录已写入审计");
        setAdjudicationNote("");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
      <p className="text-sm font-medium text-[var(--color-fg)]">
        比分更正与恢复 · {teamAName} vs {teamBName}（{format.toUpperCase()}）
      </p>
      <p className="text-xs text-[var(--color-fg-mid)]">
        先计算影响清单并审阅；改变胜者会要求显式确认恢复。已开始/完成的下游比赛不会被自动改写。
      </p>

      {!plan ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">{teamAName}</Label>
              <Input
                className="w-20"
                inputMode="numeric"
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                placeholder="比分"
              />
            </div>
            <span className="pb-2 text-sm text-[var(--color-fg-mid)]">:</span>
            <div>
              <Label className="text-xs">{teamBName}</Label>
              <Input
                className="w-20"
                inputMode="numeric"
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
                placeholder="比分"
              />
            </div>
            <label className="flex items-center gap-1 pb-2 text-xs text-[var(--color-fg-mid)]">
              <input
                type="checkbox"
                checked={isForfeit}
                onChange={(e) => setIsForfeit(e.target.checked)}
              />
              弃赛判负
            </label>
            <Button size="sm" variant="outline" onClick={handlePlan} disabled={isPending}>
              {isPending ? "计算中..." : "计算影响清单"}
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-2 text-xs">
          <p className="text-[var(--color-fg)]">
            当前 {plan.current.isForfeit ? `${plan.current.scoreA}:${plan.current.scoreB}（弃赛）` : `${plan.current.scoreA ?? "-"}:${plan.current.scoreB ?? "-"}`}
            {" → "}
            提议 {plan.proposed.isForfeit ? `${plan.proposed.scoreA}:${plan.proposed.scoreB}（弃赛）` : `${plan.proposed.scoreA}:${plan.proposed.scoreB}`}
            {plan.winnerChanges && " · ⚠️ 胜者将变更"}
          </p>
          {plan.impacts.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-fg-mid)]">
              {plan.impacts.map((impact) => (
                <li key={`${impact.kind}-${impact.matchId ?? impact.managedKey ?? impact.description}`}>
                  [{impact.kind}] {impact.status} — {impact.description}
                </li>
              ))}
            </ul>
          )}
          {plan.blockedReasons.length > 0 && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2">
              <p className="font-medium text-red-500">已拒绝执行（fail closed）：</p>
              <ul className="list-disc pl-4">
                {plan.blockedReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="mt-1">如确需处理，请通过下方「赛后裁决」流程记录独立事实。</p>
            </div>
          )}
          {plan.requiredRecoveryActions.length > 0 && !plan.blockedReasons.length && (
            <ul className="list-decimal space-y-0.5 pl-4 text-[var(--color-fg-mid)]">
              {plan.requiredRecoveryActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {plan.winnerChanges && plan.blockedReasons.length === 0 && (
              <Button size="sm" onClick={() => handleApply(true)} disabled={isPending}>
                确认恢复并应用更正
              </Button>
            )}
            {!plan.winnerChanges && plan.blockedReasons.length === 0 && (
              <Button size="sm" onClick={() => handleApply(false)} disabled={isPending}>
                应用比分更正
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setPlan(null)} disabled={isPending}>
              返回修改
            </Button>
          </div>
        </div>
      )}

      {/* 赛后裁决入口始终可用：用于 fail-closed 场景的独立事实记录 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-2">
        <input
          className="h-8 flex-1 min-w-48 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-xs"
          placeholder="赛后裁决说明（用于被拒绝自动重写的场景）"
          value={adjudicationNote}
          onChange={(e) => setAdjudicationNote(e.target.value)}
        />
        <Button size="sm" variant="ghost" onClick={handleAdjudicate} disabled={isPending}>
          记录裁决
        </Button>
      </div>
    </div>
  );
}
