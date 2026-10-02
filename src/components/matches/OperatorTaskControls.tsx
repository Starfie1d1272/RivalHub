"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatOperatorElapsed } from "@/lib/admin/matches/operator-workflow";

export function OperatorTaskControls({ elapsed }: { elapsed: { since: string; label: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!elapsed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [elapsed]);
  return <div className="flex flex-wrap items-center gap-3">
    {elapsed && <p className="text-sm text-[var(--color-fg-mid)]">{elapsed.label} <span className="font-mono tabular-nums">{now === null ? "—" : formatOperatorElapsed(elapsed.since, now)}</span></p>}
    <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "刷新中…" : "刷新当前任务"}</Button>
  </div>;
}
