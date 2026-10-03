"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRoutePolling } from "@/components/use-visible-polling";
import { Button } from "@/components/ui/button";
import { formatOperatorElapsed } from "@/lib/admin/matches/operator-workflow";

export function OperatorTaskControls({ elapsed }: { elapsed: { since: string; label: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRoutePolling(30000, pending);
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!elapsed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [elapsed]);
  return <div className="flex flex-wrap items-center gap-3">
    {elapsed && <p className="text-sm text-[var(--color-fg-mid)]">{elapsed.label} <span className="font-mono tabular-nums">{now === null ? "—" : formatOperatorElapsed(elapsed.since, now)}</span></p>}
    {elapsed && now !== null && now - new Date(elapsed.since).getTime() >= 600000 && <p role="status" className="text-sm text-[var(--color-warn)]">图间已达 10 分钟，请核对下一图房间并提醒双方进入。</p>}
    <Button size="sm" variant="outline" disabled={pending} onClick={() => { setRefreshed(new Date().toLocaleTimeString("zh-CN", { hour12: false })); startTransition(() => router.refresh()); }}>{pending ? "刷新中…" : "更新比赛信息"}</Button>
    <span role={refreshed ? "status" : undefined} className="text-xs text-[var(--color-fg-mid)]">{refreshed && !pending ? `已更新 ${refreshed} · ` : ""}每 30 秒自动更新</span>
  </div>;
}
