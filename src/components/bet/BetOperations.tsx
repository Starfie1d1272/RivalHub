"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm, HelpTooltip } from "@/components/rivalhub";
import { operateBet } from "@/actions/bet";
import { betStateLabel,formatPoints } from "@/lib/bet/presentation";
import type { BetBoardDTO } from "@/lib/bet/types";
export function BetOperations({data,slug,pending}:{data:BetBoardDTO;slug:string;pending:boolean}) {
  const router=useRouter();const [busy,startTransition]=useTransition();
  const [action,setAction]=useState<{operation:"enable"|"pause"|"resume"|"close"|"void"|"retry";marketId?:string}|null>(null);const [reason,setReason]=useState("");
  function run(){if(!action||busy)return;startTransition(async()=>{const r=await operateBet({seasonId:data.seasonId,...action,...(action.operation==="void"?{reason}: {})});if(!r.success)toast.error(r.error.message);else{setAction(null);setReason("");router.refresh();}});}
  const labels={enable:"启用 BET",pause:"暂停投入",resume:"恢复投入",close:"提前锁盘",void:"作废并退款",retry:"重试结算"};
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">BET</h1><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{!data.enabled?"未启用":data.paused?"投入已暂停":"运行中"} <HelpTooltip label="BET 运营规则" content="盘口随官方对阵、BP 与地图进度自动开放。积分初始补给为 1,000，后续正赛阶段补给为 300。锁盘永久生效；更正答案请修改官方赛果。"/></p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href={`/${slug}/bet` as never}>查看公开页面</Link></Button><Button disabled={busy} onClick={()=>setAction({operation:!data.enabled?"enable":data.paused?"resume":"pause"})}>{!data.enabled?"启用 BET":data.paused?"恢复投入":"暂停投入"}</Button>{pending&&data.enabled&&<Button variant="outline" disabled={busy} onClick={()=>setAction({operation:"retry"})}>重试结算</Button>}</div></header>
    <div className="flex flex-wrap gap-6 border-y border-[var(--color-border)] py-4 text-sm">{["open","locked","settled","refunded"].map(state=><span key={state}>{betStateLabel[state as keyof typeof betStateLabel]} <b className="ml-2 font-mono">{data.markets.filter(m=>m.state===state).length}</b></span>)}{pending&&<span className="text-[var(--color-warn)]">等待处理官方更新</span>}</div>
    {action&&<div className="space-y-2">{action.operation==="void"&&<Input aria-label="退款原因" placeholder="填写退款原因" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/>}<InlineConfirm title={`确认${labels[action.operation]}？`} sub={action.operation==="close"?"此盘口将永久停止接受投入。":action.operation==="void"?"所有投入将原额返还，并保留流水和退款原因。":action.operation==="resume"?"只恢复仍开放的盘口；已锁盘口不会重开。":action.operation==="retry"?"从最新官方事实重新处理待结算与更正。":"盘口生命周期与结算由赛事官方事实驱动。"} danger={action.operation==="void"} onCancel={()=>{if(!busy)setAction(null);}} onConfirm={run} confirmLabel={busy?"处理中…":labels[action.operation]}/></div>}
    <div className="overflow-x-auto border border-[var(--color-border)]"><table className="w-full text-sm"><thead className="bg-[var(--color-panel-low)] text-left text-[var(--color-fg-mid)]"><tr>{["比赛 / 赛事","盘口","奖池","人数","状态","操作"].map(label=><th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-[var(--color-border)]">{data.markets.map(m=>{const match=data.matches.find(x=>x.id===m.matchId);return <tr key={m.id}><td className="px-4 py-3">{match?`${match.a} vs ${match.b}`:"Main Event"}</td><td className="px-4 py-3"><p>{m.title}</p><p className="text-xs text-[var(--color-fg-dim)]">{m.context}</p></td><td className="px-4 py-3 text-right font-mono tabular-nums">{formatPoints(m.pool)}</td><td className="px-4 py-3 text-right font-mono">{m.participants}</td><td className="whitespace-nowrap px-4 py-3">{betStateLabel[m.state]}</td><td className="px-4 py-3"><div className="flex gap-2">{m.state==="open"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>setAction({operation:"close",marketId:m.id})}>锁盘</Button>}{m.state!=="refunded"&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>setAction({operation:"void",marketId:m.id})}>退款</Button>}</div></td></tr>;})}</tbody></table>{!data.markets.length&&<p className="p-10 text-center text-sm text-[var(--color-fg-mid)]">{data.enabled?"等待官方对阵或正赛名单":"启用后自动开放符合条件的盘口"}</p>}</div>
  </div>;
}
