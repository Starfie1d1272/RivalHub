"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { takeOverMatchMap } from "@/actions/match-operations";

export function ManualMapTakeover({ matchId, scope, mapLabel, reportContext }: { matchId: string; mapLabel?: string; reportContext?: { programSourceGeneration: number; lastReliableSeq: number; currentMapId: string | null }; scope: { sessionId: string; mapEpoch: number; mapId: string; recoverMapBinding?: boolean } }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <details className="space-y-3 rounded border border-[var(--color-border)] p-3"><summary className="cursor-pointer text-sm">{reportContext ? "采集异常与备用录分" : "备用录分 · 本图改用手动"}</summary>
    {reportContext && <div className="space-y-2 text-sm"><p>先检查 Mizar 与游戏采集。已确认无法自动记录时，可为 {mapLabel} 登记问题并手动录分。</p><label className="block space-y-1">已确认的采集问题<Input maxLength={500} disabled={pending || confirming} value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：采集电脑断网，已核对本场与地图" /></label></div>}
    {scope.recoverMapBinding && <p className="text-sm">未能确认当前地图。请核对正式地图计划：{mapLabel}。确认后将此图作为当前图，并人工记录赛果。</p>}
    {confirming && <p className="text-sm">本图将由你核对并提交最终比分，正式结果受到保护。下一图通过核验后恢复自动记录。Mizar 采集与 HUD 继续按各自状态运行，采集问题请继续在 Mizar 处理。</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="outline" disabled={pending} onClick={() => {
      if (reportContext && !reason.trim()) { setError("请填写已确认的采集问题。"); return; }
      if (!confirming) { setError(null); setConfirming(true); return; }
      startTransition(async () => {
        const result = await takeOverMatchMap(matchId, { ...scope, ...(reportContext ? { operatorReport: { ...reportContext, reason: reason.trim() } } : {}) });
        if (!result.success) setError(result.error.message);
        else { setConfirming(false); setError(null); router.refresh(); }
      });
    }}>{pending ? "正在接管…" : confirming ? "确认：本图改用手动比分" : scope.recoverMapBinding ? "确认当前地图并恢复手动录分" : "改为手动录入本图比分"}</Button>
    {confirming && <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>取消</Button>}
  </details>;
}
