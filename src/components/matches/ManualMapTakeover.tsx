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
  return <div className="space-y-2">
    {scope.recoverMapBinding && <p className="text-sm">未能确认当前地图。请核对正式地图计划：{mapLabel}。确认后将此图作为当前图，并人工记录赛果。</p>}
    {confirming && <p className="text-sm">确认后，本图停止自动写入比分，并显示手动比分表单；由你在本图结束后核对并提交。迟到的自动结果不会覆盖手动结果，已有正式比分不会被改写。下一图核验通过后恢复自动记录。此操作不切换 Mizar 设备，也不操作 HUD、OBS 或开播；现有身份或阵容异常仍需修复，网站实时数据不会因此解除校验。</p>}
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
  </div>;
}
