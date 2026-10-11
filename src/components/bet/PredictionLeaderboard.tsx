"use client";
import { useState, useTransition, Fragment } from "react";
import type { ActionResult } from "@/types/action";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { formatPoints } from "@/lib/bet/presentation";
import { cn } from "@/lib/utils/cn";
import type { PredictionRankingModel, PredictionRankingSort } from "./presentation-contract";

const sorts = [{ key: "profit", label: "净收益" }, { key: "hits", label: "赛果命中次数" }, { key: "accuracy", label: "赛果命中率" }] as const;

/** Ordering, qualification and competition ties come from the canonical read model. */
export function PredictionLeaderboard({ rankings, refreshAction }: { rankings: Record<PredictionRankingSort, PredictionRankingModel>; refreshAction?: (sort: PredictionRankingSort) => Promise<ActionResult<PredictionRankingModel>> }) {
  const [sort, setSort] = useState<PredictionRankingSort>("profit");
  const [snapshot, setSnapshot] = useState({ origin: rankings, value: rankings });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const model = (snapshot.origin === rankings ? snapshot.value : rankings)[sort];
  function changeSort(next: PredictionRankingSort) {
    setSort(next);
    if (!refreshAction) return;
    startTransition(async () => {
      try {
        const result = await refreshAction(next);
        if (result.success) { setSnapshot(previous => ({ origin: rankings, value: { ...(previous.origin === rankings ? previous.value : rankings), [next]: result.data } })); setError(null); }
        else setError(result.error.message);
      } catch { setError("排行更新失败，请刷新后查看。"); }
    });
  }
  return <section aria-label="竞猜排行榜" className="min-w-0 space-y-3">
    <div role="group" aria-label="排行榜排序" className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
      {sorts.map(item => <button key={item.key} type="button" aria-pressed={sort === item.key} disabled={pending} onClick={() => changeSort(item.key)} className={cn("border-b-2 px-2 py-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]", sort === item.key ? "border-[var(--color-accent)]" : "border-transparent text-[var(--color-fg-mid)]")}>{item.label}</button>)}
    </div>
    {error && <p role="status" className="text-xs text-[var(--color-warn)]">{error}</p>}
    {sort !== "profit" && model.floor !== null && <div className="flex flex-wrap justify-end gap-2 text-xs text-[var(--color-fg-dim)]"><span>{model.rankedCount} ranked · {model.rows.length - model.rankedCount} limited</span><span>至少 {model.floor} 场 <HelpTooltip label="赛果排名资格说明" content="资格线复用当前赛事完整总体的有效样本 P75 × 25%，向上取整、最少一场。筛选和分页不改变资格线；低样本保留真实成绩但不编号。仅统计已产生可评判结果的免费赛果预测，BP 不计入。"/></span></div>}
    <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-panel)]">
      <table className="w-full table-fixed text-xs sm:text-sm"><caption className="sr-only">{sorts.find(item => item.key === sort)!.label}排行榜</caption>
        <thead><tr className="border-b border-[var(--color-border)] text-[10px] text-[var(--color-fg-mid)] sm:text-xs"><th className="w-[34%] px-1.5 py-3 text-left sm:px-2">排名与用户</th>{["净收益", "命中次数", "命中率"].map(label => <th key={label} className="whitespace-nowrap px-1.5 py-3 text-right sm:px-2">{label}</th>)}</tr></thead>
        <tbody>{model.rows.map((row, index) => <Fragment key={row.userId}>
          {sort !== "profit" && index === model.rankedCount && <tr><td colSpan={4} className="bg-[var(--color-panel-low)] px-3 py-2 text-xs text-[var(--color-fg-dim)]">Limited sample{model.floor !== null && ` · 少于 ${model.floor} 场`}</td></tr>}
          <tr className="border-b border-[var(--color-border)]">
            <td className="px-1.5 py-3 sm:px-2"><div className="flex min-w-0 items-center gap-2"><span className="shrink-0 font-mono tabular-nums text-[var(--color-fg-dim)]">{row.rank === null ? "—" : `#${row.rank}`}</span><span className="truncate" title={row.name}>{row.playerUserId ? <PlayerProfileLink userId={row.playerUserId}>{row.name}</PlayerProfileLink> : row.name}</span></div></td>
            <td className="whitespace-nowrap px-1.5 py-3 text-right sm:px-2 font-mono tabular-nums">{row.profit === null ? "—" : `${BigInt(row.profit) > BigInt(0) ? "+" : ""}${formatPoints(row.profit)}`}</td>
            <td className="px-1.5 py-3 text-right font-mono sm:px-2 tabular-nums">{row.hits ?? "—"}</td>
            <td className="px-1.5 py-3 text-right font-mono sm:px-2 tabular-nums">{row.accuracy === null ? "—" : `${(row.accuracy * 100).toFixed(1)}%`}</td>
          </tr>
        </Fragment>)}{!model.rows.length && <tr><td colSpan={4} className="py-12 text-center text-[var(--color-fg-mid)]">暂无排名</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
