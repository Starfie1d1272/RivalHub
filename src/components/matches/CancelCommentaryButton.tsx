"use client";

import React, { useState, useTransition } from "react";
import { cancelMatchCommentary } from "@/actions/postmatch";
import { InlineConfirm } from "@/components/rivalhub/InlineConfirm";
import { Button } from "@/components/ui/button";

export function CancelCommentaryButton({ matchId }: { matchId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelMatchCommentary({ matchId });
        if (result.success) setCancelled(true);
        else setError(result.error.message);
      } catch {
        setError("取消认领未完成，请重试。");
      }
    });
  }

  return <div className="space-y-1">
    {confirming ? <InlineConfirm title="取消本场解说认领？" sub="将释放你的名额，其他解说可继续认领。" confirmLabel="确认取消认领" onConfirm={cancel} onCancel={() => setConfirming(false)} />
      : <Button type="button" size="sm" variant="outline" disabled={pending || cancelled} onClick={() => setConfirming(true)}>{pending ? "正在取消…" : cancelled ? "已取消认领" : "取消认领"}</Button>}
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
  </div>;
}
