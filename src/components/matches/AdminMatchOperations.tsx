"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isAdminMatchInScope, parseAdminOperationsFilter, type AdminOperationsFilter } from "@/lib/admin/matches/workspace-filters";
import { MatchWorkbenchLink as Link } from "./MatchWorkbenchLink";
import { toast } from "sonner";
import { AdminPlayerContact } from "@/components/admin/AdminPlayerContact";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { formatCSTDateTime } from "@/lib/utils/date";
import { presentMatchStage } from "@/lib/matches/presentation";
import type { AdminMatchOperationsRow } from "@/lib/admin/matches/operations";

const LABELS = { unproposed: "待提议", pending: "待对方确认", confirmed: "已确认", reschedule_pending: "改期待回应", inactive: "进行中" };
type Filter = AdminOperationsFilter;

export function AdminMatchOperations({ rows, seasonSlug, stage, team, stageNames, hasBet = false }: {
  rows: AdminMatchOperationsRow[]; seasonSlug: string; stage?: string; team?: string; stageNames: Record<string, string>; hasBet?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const filter = parseAdminOperationsFilter(search.get("ops"));
  function setFilter(value: Filter) {
    const query = new URLSearchParams(search.toString());
    if (value === "todo") query.delete("ops"); else query.set("ops", value);
    router.replace(`${pathname}?${query}` as never, { scroll: false });
  }
  const scoped = rows.filter(row => isAdminMatchInScope(row, { stage, team }));
  const matchesFilter = (row: AdminMatchOperationsRow, value: Filter) => value === "all" ||
    (value === "todo" ? row.awaitingEntryIds.length > 0 || row.commentators.length === 0 || row.conflicts.length > 0 :
      value === "uncovered" ? row.commentators.length === 0 : value === "conflict" ? row.conflicts.length > 0 : row.scheduling.state === value);
  const shown = scoped.filter(row => matchesFilter(row, filter));
  async function copyReminder(row: AdminMatchOperationsRow) {
    const who = row.teams.filter(t => row.awaitingEntryIds.includes(t.id)).map(t => t.name).join("、");
    const message = `${row.teams.map(t => t.name).join(" vs ")}：${who ? `请 ${who} ` : "请双方 "}${row.scheduling.pending ? `回应拟定比赛时间 ${formatCSTDateTime(row.scheduling.pending.proposedTime)}` : "提议比赛时间"}。${row.scheduledAt ? `原定时间 ${formatCSTDateTime(row.scheduledAt)} 仍有效。` : ""}${row.completionDeadline ? `最晚完成 ${formatCSTDateTime(row.completionDeadline)}。` : ""}比赛入口：${window.location.origin}/${seasonSlug}/matches/${row.id}?scheduling=1`;
    try { await navigator.clipboard.writeText(message); toast.success("催办文字已复制"); }
    catch { toast.error("无法复制，请手动复制比赛入口"); }
  }
  const todoCount = scoped.filter(row => matchesFilter(row, "todo")).length;
  return <Panel contentClassName="space-y-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold tracking-tight">赛务待办</h2><p className="mt-1 text-xs text-[var(--color-fg-mid)]">当前范围 · {scoped.length} 场进行中或待进行的比赛</p></div>
      <div className="flex items-baseline gap-1.5 text-[var(--color-fg-mid)]"><strong className="text-2xl font-semibold tabular-nums text-[var(--color-fg)]">{todoCount}</strong><span className="text-xs">场待处理</span></div>
    </div>
    <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border)] pb-4" aria-label="赛务状态筛选">
      {([ ["todo", "待办"], ["unproposed", LABELS.unproposed], ["pending", LABELS.pending], ["confirmed", LABELS.confirmed], ["reschedule_pending", LABELS.reschedule_pending], ["uncovered", "无解说"], ["conflict", "同刻撞档"], ["all", "全部"] ] as const).map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "default" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{" "}<span className="ml-1.5 tabular-nums opacity-70">{scoped.filter(row => matchesFilter(row, value)).length}</span></Button>)}
    </div>
    {shown.length === 0 ? <p className="py-6 text-center text-sm text-[var(--color-fg-mid)]">当前范围没有此类赛务任务</p> : <ul className="divide-y divide-[var(--color-border)]">{shown.map(row => {
      const awaiting = row.teams.filter(t => row.awaitingEntryIds.includes(t.id)).map(t => t.name).join("、");
      const nextStep = awaiting ? `${awaiting} ${row.scheduling.state === "unproposed" ? "提议时间" : "回应时间"}` : row.conflicts.length ? "核对解说同刻撞档" : row.commentators.length === 0 ? "安排解说认领" : "排期与解说已就绪";
      const attention = awaiting.length > 0 || row.conflicts.length > 0 || row.commentators.length === 0;
      const displayedTime = row.scheduling.pending?.proposedTime ?? row.scheduledAt;
      return <li key={row.id} id={`operation-${row.id}`} className="scroll-mt-4 min-w-0 py-4 first:pt-0 last:pb-0">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-mid)]"><span>{stageNames[row.stage] ?? presentMatchStage(row.stage)}{row.round ? ` · 第 ${row.round} 轮` : ""}</span><span className="rounded-sm border border-[var(--color-border)] px-1.5 py-0.5">{LABELS[row.scheduling.state]}</span></div>
            <h3 className="break-words text-base font-semibold leading-relaxed">{row.teams.map((t, i) => <React.Fragment key={t.id}>{i > 0 && <span className="mx-2 text-xs font-normal text-[var(--color-fg-dim)]"> vs </span>}{t.name}</React.Fragment>)}</h3>
            <p className={`mt-1.5 text-sm font-medium ${attention ? "text-[var(--color-warn)]" : "text-[var(--color-fg-mid)]"}`}><span className="mr-1.5 text-xs font-normal text-[var(--color-fg-dim)]">下一步</span>{nextStep}</p>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 sm:flex-col sm:items-end sm:text-right">
            <div><p className={`text-base font-semibold tabular-nums ${displayedTime ? "text-[var(--color-fg)]" : "text-[var(--color-fg-mid)]"}`}>{displayedTime ? formatCSTDateTime(displayedTime) : "尚未确定时间"}</p><p className="mt-1 text-xs text-[var(--color-fg-dim)]">{row.scheduling.pending ? "拟定开赛" : row.scheduledAt ? "已确认开赛" : "等待双方协商"}</p></div>
            <Link sourceAnchor={`operation-${row.id}`} className="text-sm font-medium text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:ring-2" href={`/admin/${seasonSlug}/matches/${row.id}`}>进入比赛工作台 <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        {row.scheduledAt && row.scheduling.pending && <p className="mt-2 text-xs text-[var(--color-fg-mid)]">回应前原定时间 {formatCSTDateTime(row.scheduledAt)} 仍有效。</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm bg-[var(--color-panel-low)] px-3 py-2">
          <p className="text-xs text-[var(--color-fg-mid)]"><span className="mr-2 font-medium text-[var(--color-fg)]">解说 {row.commentators.length}/2</span>{row.commentators.map(p => p.name).join("、") || "尚未认领"}<span className="ml-2 text-[var(--color-fg-dim)]">· 在解说队列或工作台认领</span></p>
          {row.completionDeadline && <p className="text-xs text-[var(--color-fg-mid)]">最晚完成 <span className="tabular-nums">{formatCSTDateTime(row.completionDeadline)}</span></p>}
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1">{row.teams.map(t => <div key={t.id} className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-[var(--color-fg-mid)]"><span>{t.name} · {t.representative?.name ?? "负责人未设置"}</span>{t.representative && <AdminPlayerContact qq={t.representative.qq} />}{t.representative && !t.representative.qq && <span className="text-[var(--color-fg-dim)]">QQ 未填写</span>}</div>)}</div>
          {row.awaitingEntryIds.length > 0 && <Button variant="outline" size="sm" onClick={() => void copyReminder(row)}>复制催办文字</Button>}
        </div>
        {row.scheduling.pending && <details className="mt-2 text-xs text-[var(--color-fg-mid)]"><summary className="w-fit cursor-pointer rounded-sm py-1 underline decoration-dotted underline-offset-4 focus-visible:ring-2">排期回应规则 · 满 24h：{formatCSTDateTime(row.responseDueAt!)}</summary><p className="mt-1 leading-relaxed">提议于 {formatCSTDateTime(row.scheduling.pending.createdAt)}。{row.scheduling.autoAcceptAt ? "自动采纳仍须运行时距开赛至少 2h。" : "需双方主动确认，不自动采纳。"}</p></details>}
        {row.conflicts.map(c => <p key={`${c.userId}-${c.matchId}`} className="mt-2 rounded-sm border border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-warn)]">{c.name} 同时认领了 <Link sourceAnchor={`operation-${row.id}`} className="underline" href={`/admin/${seasonSlug}/matches/${c.matchId}`}>{c.isTest ? "测试赛" : "另一场正式赛"}</Link>，两场均定于 {formatCSTDateTime(c.scheduledAt)}。<span className="block text-xs">仅核对相同开赛时刻，不推测比赛时长。</span></p>)}
      </li>;
    })}</ul>}
    {hasBet && <Link className="inline-block text-xs text-[var(--color-accent)] underline" href={`/admin/${seasonSlug}/bet`}>进入竞猜运营 →</Link>}
  </Panel>;
}
