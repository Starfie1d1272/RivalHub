"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { formatPoints } from "@/lib/bet/presentation";
import type { ActionResult } from "@/types/action";
import type { BetReliefModel } from "./presentation-contract";

export function BetRelief({ model, claimAction, refreshAction, onClaimed }: {
  model: BetReliefModel;
  claimAction: () => Promise<ActionResult<BetReliefModel>>;
  refreshAction: () => Promise<ActionResult<BetReliefModel>>;
  onClaimed: () => void;
}) {
  const version = JSON.stringify(model);
  const [snapshot, setSnapshot] = useState({ origin: version, value: model });
  const current = snapshot.origin === version ? snapshot.value : model;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function claim() {
    if (!current.canClaim || pending) return;
    startTransition(async () => {
      try {
        const result = await claimAction();
        if (result.success) { setSnapshot({ origin: version, value: result.data }); setError(null); onClaimed(); }
        else {
          setError(result.error.message);
          const fresh = await refreshAction();
          if (fresh.success) setSnapshot({ origin: version, value: fresh.data });
        }
      } catch { setError("领取结果暂未确认，请刷新钱包后查看。"); }
    });
  }
  return <div className="space-y-1 text-xs">
    <div className="flex items-center gap-1">
      {current.canClaim ? <Button size="sm" variant="outline" disabled={pending} onClick={claim}>{pending ? "领取中…" : `领取低保 +${formatPoints(current.amount)}`}</Button> : <span className="text-[var(--color-fg-dim)]">{current.status === "claimed_today" ? "今日已领低保" : current.status === "exhausted" ? "本届低保额度已用尽" : current.reason ?? "暂不可领取低保"}</span>}
      <HelpTooltip label="低保规则" content="已领取初始积分且余额为 0–9 时，可主动补至 10。北京时间每日最多一次，每届累计最多 100；剩余额度不足时只发剩余部分。债务不通过低保抵消。低保不计净收益，不影响免费预测。"/>
    </div>
    {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
  </div>;
}
