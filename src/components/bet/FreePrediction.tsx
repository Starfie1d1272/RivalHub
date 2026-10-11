"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { cn } from "@/lib/utils/cn";
import type { FreePredictionControls, FreePredictionModel } from "./presentation-contract";

function panelVersion(model: FreePredictionModel) {
  return JSON.stringify([model.matchId, model.kind, model.requiredChoices, model.options.map(option => option.key), [...model.own].sort(), model.canSubmit, model.status, model.result]);
}

const labels = { open: "可预测", locked: "已锁定", judged: "已评判", void: "已作废", unavailable: "暂不可用" };

export function FreePrediction({ model, signedIn, controls }: {
  model: FreePredictionModel;
  signedIn: boolean;
  controls: FreePredictionControls;
}) {
  const version = panelVersion(model);
  const [snapshot, setSnapshot] = useState<{ origin: string; source: FreePredictionModel; value: FreePredictionModel } | null>(null);
  const current = snapshot?.origin === version
    ? snapshot.source === model ? snapshot.value : { ...model, own: snapshot.value.own, result: snapshot.value.result, status: snapshot.value.status, canSubmit: snapshot.value.canSubmit }
    : model;
  const [draft, setDraft] = useState<{ origin: string; keys: string[] } | null>(null);
  const keys = draft?.origin === panelVersion(current) ? draft.keys : current.own;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const changed = keys.length !== current.own.length || keys.some(key => !current.own.includes(key));
  const title = current.kind === "winner" ? "免费赛果预测" : "免费 BP 预测";
  function choose(key: string) {
    const next = current.requiredChoices === 1 ? [key] : keys.includes(key) ? keys.filter(value => value !== key) : [...keys, key];
    if (next.length > current.requiredChoices) return;
    setDraft({ origin: panelVersion(current), keys: next });
    setError(null);
  }
  function submit() {
    if (pending || !current.canSubmit || !signedIn || keys.length !== current.requiredChoices || !changed) return;
    startTransition(async () => {
      try {
        const result = await controls.submitAction(current, keys);
        if (result.success) {
          setSnapshot({ origin: version, source: model, value: result.data });
          setDraft(null);
          setError(null);
        } else {
          setError(result.error.message);
          const fresh = await controls.refreshAction(current);
          if (fresh.success) { setSnapshot({ origin: version, source: model, value: fresh.data }); setDraft(null); }
        }
      } catch {
        setError("提交结果暂未确认，请刷新后查看当前预测。");
      }
    });
  }
  return <section aria-label={title} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <h3 className="inline-flex items-center gap-1 font-semibold">{title}<HelpTooltip label={`${title}规则`} content={current.kind === "winner" ? "不扣积分，余额为零也可预测。与 BET 独立，可选不同队伍；实际对局开始前可改选。每人每场一票，只统计可评判的正式赛果。" : `选 ${current.requiredChoices} 张不同地图，不计顺序。正式 BP 开始即锁定，完整地图集合全中才算命中；与地图 BET 独立。`}/></h3>
      <span className="text-xs text-[var(--color-fg-dim)]">{labels[current.status]}</span>
    </div>
    <div className={cn("grid gap-2", current.options.length > 2 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2")}>
      {current.options.map(option => {
        const selected = keys.includes(option.key);
        const correct = current.result?.answer.includes(option.key);
        const percent = option.count !== null && current.participants > 0 ? option.count / current.participants * 100 : null;
        return <button key={option.key} type="button" aria-pressed={selected} disabled={pending || !signedIn || !current.canSubmit || !selected && keys.length >= current.requiredChoices && current.requiredChoices > 1} onClick={() => choose(option.key)} className={cn("min-w-0 border p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]", selected ? "border-[var(--color-accent)] bg-[var(--color-panel-hi)]" : "border-[var(--color-border)] bg-[var(--color-panel-low)]")}>
          <span className="flex min-w-0 items-center gap-1"><span className="truncate" title={option.label}>{option.label}</span>{selected && <Check size={12} className="shrink-0 text-[var(--color-accent)]"/>}</span>
          {current.kind === "winner" && <span className="mt-1 block font-mono text-xs tabular-nums text-[var(--color-fg-mid)]">{percent === null ? "—" : `${percent.toFixed(1)}%`} · {option.count ?? "—"} 人</span>}
          {correct && <span className="mt-1 block text-xs text-[var(--color-accent)]">正确结果</span>}
        </button>;
      })}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-dim)]">
      <span>{current.result ? current.result.hit ? "已命中" : `未命中${current.kind === "bp" ? ` · ${current.result.matched}/${current.result.total}` : ""}` : current.own.length ? "已提交" : "尚未提交"}{current.kind === "bp" && current.canSubmit && ` · 已选 ${keys.length}/${current.requiredChoices}`}</span>
      {!signedIn ? <Button size="sm" variant="outline" asChild><Link href="/login">登录预测</Link></Button> : current.canSubmit && <div className="flex gap-2">{changed && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(null); setError(null); }}>取消改选</Button>}<Button size="sm" disabled={pending || !changed || keys.length !== current.requiredChoices} onClick={submit}>{pending ? "提交中…" : current.own.length ? "更新预测" : "提交预测"}</Button></div>}
    </div>
    {current.reason && <p role="status" className="text-xs text-[var(--color-fg-dim)]">{current.reason}</p>}
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
  </section>;
}
