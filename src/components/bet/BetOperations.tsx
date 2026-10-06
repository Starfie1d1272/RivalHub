"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineConfirm, HelpTooltip, PageHeader, ListToolbar, ListSearchField, ClearFilters, ResultSummary, PaginationControls, useListQueryParams } from "@/components/rivalhub";
import type { ListSearchFieldHandle } from "@/components/rivalhub/ListSearchField";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { operateBet } from "@/actions/bet";
import { betStateLabel, formatPoints } from "@/lib/bet/presentation";
import { BET_GROUPS, BET_OPERATION_PAGE_SIZE, betOperationsList, type BetOperationsQuery } from "@/lib/bet/operations";
import type { BetBoardDTO, BetMarketDTO, BetState } from "@/lib/bet/types";
import { formatCSTDateTime } from "@/lib/utils/date";

const STATES: BetState[] = ["open", "locked", "settled", "refunded"];
const FILTER_KEYS = ["q", "state", "category", "stage"];
const labels = { enable: "启用 BET", pause: "暂停投入", resume: "恢复投入", close: "提前锁盘", void: "作废并退款", retry: "重试结算" };
type Operation = keyof typeof labels;

export function BetOperations({ data, slug, pending, query }: {
  data: BetBoardDTO; slug: string; pending: boolean; query: BetOperationsQuery;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [action, setAction] = useState<{ operation: Operation; marketId?: string } | null>(null);
  const [reason, setReason] = useState("");
  const search = useRef<ListSearchFieldHandle>(null);
  const { searchParams, update } = useListQueryParams({ preserveScroll: true });
  const list = betOperationsList(data, query);
  const target = data.markets.find(m => m.id === action?.marketId);
  const targetMatch = data.matches.find(m => m.id === target?.matchId);
  const targetLabel = target ? `${targetMatch ? `${targetMatch.a} vs ${targetMatch.b}` : "正赛赛事盘"} · ${target.title}${target.context ? ` · ${target.context}` : ""}` : "";

  function run() {
    if (!action || busy || action.operation === "void" && !reason.trim()) return;
    startTransition(async () => {
      const result = await operateBet({ seasonId: data.seasonId, ...action, ...(action.operation === "void" ? { reason } : {}) });
      if (!result.success) toast.error(result.error.message);
      else { setAction(null); setReason(""); router.refresh(); }
    });
  }
  function filter(key: string, value: string) {
    search.current?.cancelPending();
    update({ [key]: value === "all" ? "" : value }, { history: "push" });
  }
  function request(operation: "close" | "void", market: BetMarketDTO) {
    setReason(""); setAction({ operation, marketId: market.id });
  }
  const fields = [
    { key: "state", label: "盘口状态", value: query.state, all: "全部状态", options: STATES.map(state => ({ value: state, label: betStateLabel[state] })) },
    { key: "category", label: "盘口类别", value: query.category, all: "全部类别", options: BET_GROUPS.map(group => ({ value: group, label: group })) },
    { key: "stage", label: "比赛阶段", value: list.stage, all: "全部阶段", options: list.stages.map(stage => ({ value: stage, label: stage })) },
  ];
  const confirmation = action && <section aria-label="BET 操作确认" className="space-y-3">
      {target && <p className="text-sm font-semibold">{targetLabel}</p>}
      {action.operation === "void" && <div className="space-y-2"><Label htmlFor="bet-refund-reason">退款原因</Label><Input id="bet-refund-reason" placeholder="填写退款原因" value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></div>}
      <InlineConfirm title={`确认${labels[action.operation]}？`} sub={action.operation === "close" ? "此盘口将永久停止接受投入。" : action.operation === "void" ? "所有投入将原额返还，并保留流水和退款原因。" : action.operation === "resume" ? "只恢复仍开放的盘口；已锁盘口不会重开。" : action.operation === "retry" ? "从最新官方事实重新处理待结算与更正。" : "盘口生命周期与结算由赛事官方事实驱动。"} danger={action.operation === "void"} onCancel={() => { if (!busy) setAction(null); }} onConfirm={run} confirmLabel={busy ? "处理中…" : labels[action.operation]} />
    </section>;
  return <div className="space-y-6">
    <PageHeader title="BET" description={<>{!data.enabled ? "未启用" : data.paused ? "投入已暂停" : "运行中"} <HelpTooltip label="BET 运营规则" content="盘口随官方对阵、BP 与地图进度自动开放。积分初始补给为 1,000，后续正赛阶段补给为 300。锁盘永久生效；更正答案请修改官方赛果。" /></>} actions={<>
      <Button variant="outline" asChild><Link href={`/${slug}/bet` as never}>查看公开页面</Link></Button>
      <Button disabled={busy} onClick={() => setAction({ operation: !data.enabled ? "enable" : data.paused ? "resume" : "pause" })}>{!data.enabled ? "启用 BET" : data.paused ? "恢复投入" : "暂停投入"}</Button>
      {pending && data.enabled && <Button variant="outline" disabled={busy} onClick={() => setAction({ operation: "retry" })}>重试结算</Button>}
    </>} />
    <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
      {STATES.map(state => <span key={state}>{betStateLabel[state]} <b className="ml-2 font-mono">{data.markets.filter(m => m.state === state).length}</b></span>)}
      <span>累计投入 <b className="ml-2 font-mono">{formatPoints(data.markets.reduce((n, m) => n + BigInt(m.pool), BigInt(0)).toString())}</b></span>
      {pending && <span className="text-[var(--color-warn)]">等待处理官方更新</span>}
    </div>
    {!target && confirmation}
    <ListToolbar aria-label="BET 管理筛选">
      <ListSearchField ref={search} queryKey="q" label="搜索比赛或盘口" placeholder="队伍、选手、地图或盘口名称" value={query.q} onDebouncedChange={q => update({ q }, { history: "push" })} className="flex-1 basis-56" />
      {fields.map(field => <div key={field.key} className="min-w-0 flex-1 basis-36 space-y-1.5">
        <Label htmlFor={`bet-filter-${field.key}`} className="text-xs text-[var(--color-fg-mid)]">{field.label}</Label>
        <Select value={field.value || "all"} onValueChange={value => filter(field.key, value)}>
          <SelectTrigger id={`bet-filter-${field.key}`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{field.all}</SelectItem>{field.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>)}
      <ClearFilters keys={FILTER_KEYS} searchParams={searchParams} onClear={values => { search.current?.reset(); update(values, { history: "push" }); }} />
    </ListToolbar>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-[var(--color-fg-mid)]">比赛与赛事盘</p><ResultSummary total={list.total} page={list.page} pageSize={BET_OPERATION_PAGE_SIZE} /></div>
    <div className="space-y-3">
      {list.groups.map(group => <details key={group.id} className="group border border-[var(--color-border)] bg-[var(--color-panel)]" aria-label={group.title}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 focus-visible:outline focus-visible:outline-[var(--color-accent)] [&::-webkit-details-marker]:hidden">
          {group.match && <div className="flex shrink-0 gap-1"><TeamLogo logoUrl={group.match.logoA} teamName={group.match.a} size="sm" /><TeamLogo logoUrl={group.match.logoB} teamName={group.match.b} size="sm" /></div>}
          <div className="min-w-0 flex-1 basis-40"><h2 className="text-sm font-semibold">{group.title}</h2><p className="mt-1 text-xs text-[var(--color-fg-dim)]">{group.match ? `${group.match.stage} · ${group.match.format}${group.match.scheduledAt ? ` · ${formatCSTDateTime(group.match.scheduledAt)}` : ""}` : "Main Event"}</p></div>
          <div className="flex flex-wrap gap-3 text-xs text-[var(--color-fg-mid)]"><span>{group.markets.length} 个盘口</span>{STATES.map(state => { const count = group.markets.filter(m => m.state === state).length; return count > 0 ? <span key={state}>{betStateLabel[state]} {count}</span> : null; })}<span>奖池 <b className="font-mono">{formatPoints(group.markets.reduce((n, m) => n + BigInt(m.pool), BigInt(0)).toString())}</b></span></div>
          <ChevronDown aria-hidden size={16} className="shrink-0 text-[var(--color-fg-dim)] group-open:rotate-180" />
        </summary>
        <div className="border-t border-[var(--color-border)]">
          {group.match && <div className="flex flex-wrap gap-4 px-4 py-3 text-xs"><Link className="text-[var(--color-accent)]" href={`/admin/${slug}/matches/${group.match.id}` as never}>打开比赛工作台 →</Link><Link className="text-[var(--color-fg-mid)]" href={`/${slug}/bet?match=${group.match.id}` as never}>查看公开盘口 →</Link></div>}
          <div className="divide-y divide-[var(--color-border)]">{group.markets.map(m => <section key={m.id} aria-label={`${group.title} · ${m.title}`} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <div className="min-w-0"><h3 className="text-sm font-semibold">{m.title}</h3>{m.context && <p className="mt-1 text-xs text-[var(--color-fg-dim)]">{m.context}</p>}<p className="mt-1 text-xs text-[var(--color-fg-mid)]">奖池 <span className="font-mono">{formatPoints(m.pool)}</span> · {m.participants} 人</p></div>
            <span className="text-xs text-[var(--color-fg-mid)]">{betStateLabel[m.state]}</span>
            <div className="flex flex-wrap gap-2">{m.state === "open" && <Button size="sm" variant="outline" disabled={busy} onClick={() => request("close", m)}>锁盘</Button>}{m.state !== "refunded" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => request("void", m)}>退款</Button>}</div>
            {target?.id === m.id && <div className="sm:col-span-3">{confirmation}</div>}
          </section>)}</div>
        </div>
      </details>)}
      {!list.total && <p className="border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-fg-mid)]">{data.markets.length ? "没有匹配的比赛或盘口" : data.enabled ? "等待官方对阵或正赛名单" : "启用后自动开放符合条件的盘口"}</p>}
    </div>
    <PaginationControls page={list.page} totalPages={list.totalPages} onPageChange={page => update({ page }, { history: "push", defaults: { page: 1 } })} />
  </div>;
}
