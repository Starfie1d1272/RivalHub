"use client";

import React, { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AdminPlayerContact } from "@/components/admin/AdminPlayerContact";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { formatCSTDateTime } from "@/lib/utils/date";
import { presentMatchStage } from "@/lib/matches/presentation";
import type { AdminMatchOperationsRow } from "@/lib/admin/matches/operations";

const LABELS = { unproposed: "待提议", pending: "待对方确认", confirmed: "已确认", reschedule_pending: "改期待回应", inactive: "进行中" };
type Filter = "todo" | keyof typeof LABELS | "uncovered" | "conflict" | "all";

export function AdminMatchOperations({ rows, seasonSlug, stage, team, stageNames }: {
  rows: AdminMatchOperationsRow[]; seasonSlug: string; stage?: string; team?: string; stageNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("todo");
  const scoped = rows.filter(row => (!stage || stage === "all" || row.stage === stage) && (!team || team === "all" || [row.entryAId, row.entryBId].includes(team)));
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
  return <Panel contentClassName="space-y-3 p-4">
    <h2 className="font-semibold">赛务待办</h2>
    <p className="text-xs text-[var(--color-fg-mid)]">全赛季进行中与待进行正式赛 {rows.length} 场 · 当前阶段 / 队伍范围 {scoped.length} 场。以下统计不受比赛生命周期筛选影响；测试赛仅参与实际解说撞档核对。</p>
    <div className="flex flex-wrap gap-2" aria-label="赛务状态筛选">
      {([ ["todo", "待办"], ["unproposed", LABELS.unproposed], ["pending", LABELS.pending], ["confirmed", LABELS.confirmed], ["reschedule_pending", LABELS.reschedule_pending], ["uncovered", "无解说"], ["conflict", "同刻撞档"], ["all", "全部"] ] as const).map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} {scoped.filter(row => matchesFilter(row, value)).length}</Button>)}
    </div>
    {shown.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">当前范围没有此类赛务任务</p> : <ul className="divide-y divide-[var(--color-border)]">{shown.map(row => <li key={row.id} className="min-w-0 space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-words">{row.teams.map(t => t.name).join(" vs ")}</strong><Link className="text-[var(--color-accent)] underline focus-visible:ring-2" href={`/admin/${seasonSlug}/matches/${row.id}`}>进入比赛工作台</Link></div>
      <p>{stageNames[row.stage] ?? presentMatchStage(row.stage)} · {row.round ? `第 ${row.round} 轮 · ` : ""}{LABELS[row.scheduling.state]}{row.scheduledAt ? ` · ${formatCSTDateTime(row.scheduledAt)}` : " · 尚未确定时间"}</p>
      {row.scheduling.pending && <p>拟定 {formatCSTDateTime(row.scheduling.pending.proposedTime)} · 提议于 {formatCSTDateTime(row.scheduling.pending.createdAt)} · 满 24h：{formatCSTDateTime(row.responseDueAt!)}{row.scheduling.autoAcceptAt ? "（仍须运行时距开赛至少 2h）" : "（需双方主动确认，不自动采纳）"}</p>}
      {row.completionDeadline && <p>最晚完成：{formatCSTDateTime(row.completionDeadline)}</p>}
      {row.awaitingEntryIds.length > 0 && <p>下一步：{row.teams.filter(t => row.awaitingEntryIds.includes(t.id)).map(t => t.name).join("、")} {row.scheduling.state === "unproposed" ? "提议时间" : "回应时间"}{row.scheduledAt ? "；回应前原定时间仍有效" : ""}</p>}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">{row.teams.map(t => <div key={t.id} className="min-w-0"><span>{t.name} · 负责人：{t.representative?.name ?? "未设置"}</span>{t.representative && <AdminPlayerContact qq={t.representative.qq} />}{t.representative && !t.representative.qq && <span className="text-xs text-[var(--color-fg-mid)]">QQ 未填写</span>}</div>)}{row.awaitingEntryIds.length > 0 && <Button variant="outline" size="sm" onClick={() => void copyReminder(row)}>复制催办文字</Button>}</div>
      <p>解说 {row.commentators.length}/2：{row.commentators.map(p => p.name).join("、") || "尚未认领"} · 在现有解说队列或比赛工作台认领</p>
      {row.conflicts.map(c => <p key={`${c.userId}-${c.matchId}`} className="text-[var(--color-warn)]">{c.name} 同时认领了 <Link className="underline" href={`/admin/${seasonSlug}/matches/${c.matchId}`}>{c.isTest ? "测试赛" : "另一场正式赛"}</Link>，两场均定于 {formatCSTDateTime(c.scheduledAt)}。仅核对相同开赛时刻，不推测比赛时长。</p>)}
    </li>)}</ul>}
    <Link className="text-xs text-[var(--color-accent)] underline" href={`/admin/${seasonSlug}/bet`}>Bet 赛务与异常盘口 → 查看原有后台</Link>
  </Panel>;
}
