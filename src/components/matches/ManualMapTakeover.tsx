"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { takeOverMatchMap } from "@/actions/match-operations";

export function ManualMapTakeover({ matchId, scope, mapLabel }: { matchId: string; mapLabel?: string; scope: { sessionId: string; mapEpoch: number; mapId: string; recoverMapBinding?: boolean } }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <details className="space-y-3 rounded border border-[var(--color-border)] p-3"><summary className="cursor-pointer text-sm">备用录分 · 本图改用手动</summary>
    {scope.recoverMapBinding && <p className="text-sm">未能确认当前地图。请核对正式地图计划：{mapLabel}。确认后将此图作为当前图，并人工记录赛果。</p>}
    {confirming && <p className="text-sm">本图将由你核对并提交最终比分，正式结果受到保护。下一图通过核验后恢复自动记录。Mizar 采集与 HUD 继续按各自状态运行，采集问题请继续在 Mizar 处理。</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="outline" disabled={pending} onClick={() => {
      if (!confirming) { setConfirming(true); return; }
      startTransition(async () => {
        const result = await takeOverMatchMap(matchId, scope);
        if (!result.success) setError(result.error.message);
        else { setConfirming(false); setError(null); router.refresh(); }
      });
    }}>{pending ? "正在接管…" : confirming ? "确认：本图改用手动比分" : scope.recoverMapBinding ? "确认当前地图并恢复手动录分" : "改为手动录入本图比分"}</Button>
    {confirming && <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>取消</Button>}
  </details>;
}
