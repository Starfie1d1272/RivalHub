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
    {confirming && <p className="text-sm">仅接管当前地图赛果，迟到的自动结果不会覆盖人工结果。下一图通过健康检查后恢复自动记录。这不会切换 Mizar 设备或控制直播。</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="outline" disabled={pending} onClick={() => {
      if (!confirming) { setConfirming(true); return; }
      startTransition(async () => {
        const result = await takeOverMatchMap(matchId, scope);
        if (!result.success) setError(result.error.message);
        else { setConfirming(false); setError(null); router.refresh(); }
      });
    }}>{pending ? "正在接管…" : confirming ? "确认人工接管本图赛果" : "人工接管本图赛果"}</Button>
    {confirming && <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>取消</Button>}
  </div>;
}
