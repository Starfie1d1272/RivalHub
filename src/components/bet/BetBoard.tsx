"use client";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { BetOptionProfile } from "./BetOptionProfile";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HelpTooltip, PageHeader } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { mutateBet, getBetBoard } from "@/actions/bet";
import { betStateLabel, formatPoints } from "@/lib/bet/presentation";
import type { BetBoardDTO, BetMarketDTO } from "@/lib/bet/types";
import { formatCSTDateTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
const filters=[{key:"open",label:"开放"},{key:"mine",label:"我的投入"},{key:"settled",label:"已结算"},{key:"event",label:"赛事"},{key:"leaderboard",label:"排行榜"},{key:"records",label:"记录"}] as const;
export function BetBoard({initial,slug,signedIn,view,matchFilter}:{initial:BetBoardDTO;slug:string;signedIn:boolean;view:string;matchFilter:string|null}) {
  const router=useRouter();const [snapshot,setSnapshot]=useState({origin:initial,value:initial});const data=snapshot.origin===initial?snapshot.value:initial;const [pending,startTransition]=useTransition();
  const [selected,setSelected]=useState<{market:BetMarketDTO;optionId:string}|null>(null);
  const [amount,setAmount]=useState("");const [allIn,setAllIn]=useState(false);const [allConfirmed,setAllConfirmed]=useState(false);
  const [requestId,setRequestId]=useState("");const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let alive=true;const refresh=async()=>{if(document.visibilityState!=="visible")return;const r=await getBetBoard({seasonId:initial.seasonId});if(alive&&r.success)setSnapshot({origin:initial,value:r.data});};const timer=setInterval(()=>void refresh(),15000);return()=>{alive=false;clearInterval(timer);};},[initial]);
  const active=filters.some(f=>f.key===view)?view:"open";
  const visible=data.markets.filter(m=>(!matchFilter||m.matchId===matchFilter) && (active==="event"?m.matchId===null:active==="mine"?!!m.mine:active==="settled"?["settled","refunded"].includes(m.state):m.matchId!==null && ["open","locked"].includes(m.state)));
  function choose(market:BetMarketDTO,optionId:string){setSelected({market,optionId});setAmount("");setAllIn(false);setAllConfirmed(false);setRequestId(crypto.randomUUID());setError(null);}
  function join(){startTransition(async()=>{const r=await mutateBet({operation:"join",seasonId:data.seasonId});if(!r.success)toast.error(r.error.message);else router.refresh();});}
  function submit(){if(!selected || pending)return;startTransition(async()=>{const r=await mutateBet({operation:"stake",seasonId:data.seasonId,marketId:selected.market.id,optionId:selected.optionId,amount:allIn?"all":amount,requestId});if(!r.success){setError(r.error.message);return;}toast.success(`已投入 ${formatPoints(r.data && "amount" in r.data?r.data.amount:"0")} 积分`);setSelected(null);router.refresh();const fresh=await getBetBoard({seasonId:data.seasonId});if(fresh.success)setSnapshot({origin:initial,value:fresh.data});});}
  const current=data.markets.find(m=>m.id===selected?.market.id);
  const selectedOption=current?.options.find(o=>o.id===selected?.optionId);
  const amountValue=allIn?BigInt(data.balance):/^[1-9]\d*$/.test(amount)?BigInt(amount):BigInt(0);
  const estimate=selectedOption && amountValue>BigInt(0)?(BigInt(current!.pool)+amountValue)*amountValue/(BigInt(selectedOption.pool)+amountValue):null;
  return <div className="space-y-6">
    <PageHeader title="BET" actions={<>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Metric label="可用积分" value={data.joined?formatPoints(data.balance):"—"} accent help="首次领取 1,000 积分；加入后的 Main Event 新阶段各补给 300，不补历史阶段。管理员可以参与，但本人参赛队伍相关盘口不可参与。排名按净收益，不按余额；至少一次已结算参与才上榜。使用赛事积分参与无抽水社区奖池。积分不能购买、交易、转账、提现或兑换现实价值；只能追加原选项，不能换边或撤回。无胜方投入、全部投入均获胜或弃权时原额退款。预计回报随奖池变化。"/>
        <Metric label="净收益" value={data.joined?`${BigInt(data.profit)>BigInt(0)?"+":""}${formatPoints(data.profit)}`:"—"}/>
        <Link href={`/${slug}/bet?view=leaderboard`} aria-label="查看 BET 排行榜" className="rounded focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"><Metric label="排名" value={data.rank?`#${data.rank}`:"未上榜"}/></Link>
        {data.enabled && !data.joined && (signedIn?<Button onClick={join} disabled={pending}>领取 1,000 积分</Button>:<Button asChild><Link href="/login">登录参与</Link></Button>)}
      </div>
    </>}/>
    {data.paused && <p role="status" className="border-l-2 border-[var(--color-warn)] pl-3 text-sm">投入已暂停，已有投入与结算记录保留。</p>}
    {BigInt(data.debt)>BigInt(0) && <p role="status" className="text-sm text-[var(--color-warn)]">待抵扣 {formatPoints(data.debt)} 积分 <HelpTooltip label="待抵扣积分说明" content="官方结果更正后产生的差额将从后续补给、退款与返还中优先抵扣。"/></p>}
    <nav aria-label="BET 筛选" className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]">
      {filters.map(f=><Link key={f.key} href={`/${slug}/bet${f.key==="open"?"":`?view=${f.key}`}` as never} aria-current={active===f.key?"page":undefined} className={cn("border-b-2 px-3 py-3 text-sm sm:px-4 focus-visible:outline focus-visible:outline-[var(--color-accent)]",active===f.key?"border-[var(--color-accent)] font-semibold text-[var(--color-fg)]":"border-transparent text-[var(--color-fg-mid)]")}>{f.label}</Link>)}
      <span className="ml-auto py-3 text-xs tabular-nums text-[var(--color-fg-dim)]">{visible.filter(m=>m.state==="open").length} 个开放盘口</span>
    </nav>
    {matchFilter && <Link href={`/${slug}/bet` as never} className="inline-block text-sm text-[var(--color-accent)]">查看全部比赛 →</Link>}
    {!data.enabled?<Empty text="BET 尚未开放"/>:active==="leaderboard"?<BetLeaderboard rows={data.leaderboard}/>:active==="records"?<BetRecords rows={data.records} signedIn={signedIn}/>:!visible.length?<Empty text={active==="mine"?"还没有投入记录":active==="settled"?"暂无已结算盘口":active==="event"?"等待正赛名单确认":"等待下一场对阵或地图"}/>:<div className={cn("grid min-w-0 items-start gap-5",!matchFilter&&"lg:grid-cols-2")}>
      {[...new Set(visible.map(m=>m.matchId))].map(id=>id?<MatchCard key={id} match={data.matches.find(m=>m.id===id)!} markets={visible.filter(m=>m.matchId===id)} slug={slug} choose={choose}/>:<section key="event" className="space-y-5 lg:col-span-2">{visible.filter(m=>!m.matchId).map(m=><div key={m.id} className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><MarketRow market={m} slug={slug} choose={choose}/></div>)}</section>)}
    </div>}
    <Dialog open={!!selected} onOpenChange={open=>{if(!open&&!pending)setSelected(null);}}><DialogContent size="sm" onInteractOutside={e=>{if(pending)e.preventDefault();}} onEscapeKeyDown={e=>{if(pending)e.preventDefault();}}>
      <DialogHeader><DialogTitle>{selected?.market.title}</DialogTitle><DialogDescription>{selectedOption?.label}{selectedOption && <BetOptionProfile option={selectedOption} slug={slug}/>}</DialogDescription></DialogHeader>
      <DialogBody className="space-y-5">
        <div className="flex justify-between text-sm"><span className="text-[var(--color-fg-mid)]">可用积分</span><span className="font-mono">{formatPoints(data.balance)}</span></div>
        <div className="space-y-2"><Label htmlFor="bet-amount">投入积分</Label><Input id="bet-amount" inputMode="numeric" value={allIn?data.balance:amount} disabled={pending} onChange={e=>{setAmount(e.target.value);setAllIn(false);setAllConfirmed(false);}} autoFocus/></div>
        <div className="grid grid-cols-4 gap-2">{[10,25,50,100].map(percent=><Button key={percent} size="sm" variant={percent===100&&allIn?"default":"outline"} disabled={pending} onClick={()=>{setAmount((BigInt(data.balance)*BigInt(percent)/BigInt(100)).toString());setAllIn(percent===100);setAllConfirmed(false);}}>{percent===100?"ALL IN":`${percent}%`}</Button>)}</div>
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4 text-sm"><span>预计返还 <HelpTooltip label="预计返还说明" content="包含本金，按本次投入后的当前奖池及所选选项独胜估算；最终返还取决于锁盘时奖池，并列胜者共同分配。"/></span><span className="font-mono text-[var(--color-accent)]">{estimate?`≈ ${formatPoints(estimate.toString())}`:"—"}</span></div>
        {allIn && <Label className="flex items-start gap-2 text-sm leading-5"><input type="checkbox" checked={allConfirmed} disabled={pending} onChange={e=>setAllConfirmed(e.target.checked)}/>确认投入全部可用积分，不能撤回</Label>}
        {current && !current.canStake && <p role="status" className="text-sm text-[var(--color-warn)]">盘口已锁定或暂停投入</p>}
        {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      </DialogBody><DialogFooter><Button variant="ghost" disabled={pending} onClick={()=>setSelected(null)}>取消</Button><Button disabled={pending || !current?.canStake || amountValue<=BigInt(0) || amountValue>BigInt(data.balance) || allIn&&!allConfirmed} onClick={submit}>{pending?"提交中…":"确认投入"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
function Metric({label,value,accent=false,help}:{label:string;value:string;accent?:boolean;help?:string}){return <div><p className="mb-1 text-xs text-[var(--color-fg-mid)]"><span className="relative inline-block">{label}{help&&<HelpTooltip className="absolute -right-3 top-0" label="BET 积分规则" content={help}/>}</span></p><p className={cn("font-mono text-2xl font-semibold tabular-nums",accent&&"text-[var(--color-accent)]")}>{value}</p></div>;}
function Empty({text}:{text:string}){return <div className="border border-dashed border-[var(--color-border)] py-16 text-center text-sm text-[var(--color-fg-mid)]">{text}</div>;}
function MatchCard({match,markets,slug,choose}:{match:BetBoardDTO["matches"][number];markets:BetMarketDTO[];slug:string;choose:(m:BetMarketDTO,o:string)=>void}) {
  const groups=[...new Set(markets.map(m=>m.group))];const defaultGroup=markets.find(m=>m.state==="open")?.group??groups[0]!;
  const [group,setGroup]=useState<string|null>(null);const shown=group && groups.includes(group as BetMarketDTO["group"])?group:defaultGroup;
  return <article className="min-w-0 overflow-hidden border border-[var(--color-border)] bg-[var(--color-panel)]">
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-fg-mid)]"><span className="font-mono tracking-wider">{match.stage} · {match.format}</span><span className="ml-auto">{match.scheduledAt?formatCSTDateTime(match.scheduledAt):"待排期"}</span><Link aria-label={`查看 ${match.a} 对 ${match.b} 比赛`} className="text-[var(--color-fg-dim)] hover:text-[var(--color-accent)]" href={`/${slug}/matches/${match.id}` as never}><ArrowUpRight size={16}/></Link></div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 p-5"><TeamProfileLink seasonSlug={slug} entryId={match.entryAId} className="flex min-w-0 flex-col items-center gap-2 text-center"><TeamLogo logoUrl={match.logoA} teamName={match.a}/><h2 className="w-full truncate text-base font-semibold" title={match.a}>{match.a}</h2></TeamProfileLink><span className="font-mono text-sm text-[var(--color-fg-dim)]">VS</span><TeamProfileLink seasonSlug={slug} entryId={match.entryBId} className="flex min-w-0 flex-col items-center gap-2 text-center"><TeamLogo logoUrl={match.logoB} teamName={match.b}/><h2 className="w-full truncate text-base font-semibold" title={match.b}>{match.b}</h2></TeamProfileLink></div>
    <div className="flex gap-4 border-b border-[var(--color-border)] px-5" role="tablist" aria-label="盘口类别">{groups.map(g=><button key={g} type="button" role="tab" aria-selected={shown===g} onClick={()=>setGroup(g)} className={cn("border-b-2 py-2 text-sm focus-visible:outline focus-visible:outline-[var(--color-accent)]",shown===g?"border-[var(--color-accent)] text-[var(--color-fg)]":"border-transparent text-[var(--color-fg-mid)]")}>{g}{markets.some(m=>m.group===g&&m.state==="open")&&<span className="ml-1.5 text-[var(--color-accent)]">·</span>}</button>)}</div>
    <div className="divide-y divide-[var(--color-border)] px-5" role="tabpanel">{markets.filter(m=>m.group===shown).map(m=><div key={m.id} className="py-4"><MarketRow market={m} slug={slug} choose={choose}/></div>)}</div>
  </article>;
}
function MarketRow({market:m,choose,slug}:{slug:string;market:BetMarketDTO;choose:(m:BetMarketDTO,o:string)=>void}) {
  const [search,setSearch]=useState("");
  const options=m.options.filter(o=>o.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section aria-label={m.title} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{m.title}</h3><HelpTooltip label={`${m.title}规则`} content={m.help}/>{m.context&&<span className="text-xs text-[var(--color-fg-dim)]">{m.context}</span>}</div><span className={cn("flex items-center gap-1 text-xs",m.state==="open"?"text-[var(--color-accent)]":"text-[var(--color-fg-dim)]")}>{m.state==="locked"&&<LockKeyhole size={11}/>} {betStateLabel[m.state]}</span></div>
    {m.options.length>16 && <Input aria-label={`搜索${m.title}选项`} placeholder="搜索队伍或选手" value={search} onChange={e=>setSearch(e.target.value)}/>}
    <div className={cn("grid gap-2",m.options.length>16&&"max-h-96 overflow-y-auto",m.options.length>6?"grid-cols-2 sm:grid-cols-4":m.options.length>2?"grid-cols-2 sm:grid-cols-4":"grid-cols-2")}>{options.map(o=>{
      const own=m.mine?.optionId===o.id;const can=m.canStake && (!m.mine || own);
      return <div key={o.id} className="flex min-w-0 items-center gap-1"><button type="button" disabled={!can} onClick={()=>choose(m,o.id)} className={cn("relative flex-1 min-w-0 overflow-hidden border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-default",own||o.winner?"border-[var(--color-accent)] bg-[var(--color-panel-hi)]":"border-[var(--color-border)] bg-[var(--color-panel-low)]",can&&"hover:border-[var(--color-accent)]")}>
        <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-[var(--color-accent)] opacity-50" style={{width:`${o.percent}%`}}/>
        <span className="flex items-center gap-1 text-sm"><span className="truncate" title={o.label}>{o.label}</span>{(own||o.winner)&&<Check size={12} className="shrink-0 text-[var(--color-accent)]"/>}</span><span className="mt-1 flex flex-wrap justify-between gap-1 text-xs font-mono tabular-nums text-[var(--color-fg-mid)]"><span>{o.percent.toFixed(0)}%</span><span>{formatPoints(o.pool)}</span></span>
      </button><BetOptionProfile option={o} slug={slug}/></div>;
    })}</div>
    {!options.length && <p className="text-sm text-[var(--color-fg-mid)]">没有匹配的选项</p>}
    <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-fg-dim)]"><span>奖池 <span className="font-mono text-[var(--color-fg-mid)]">{formatPoints(m.pool)}</span> · {m.participants} 人</span>{m.mine&&<span className="text-[var(--color-fg-mid)]">已投 {formatPoints(m.mine.amount)}{m.mine.payout!==null&&<> → {formatPoints(m.mine.payout)} <span className="font-mono text-[var(--color-accent)]">{BigInt(m.mine.profit??"0")>BigInt(0)?"+":""}{formatPoints(m.mine.profit??"0")}</span></>}</span>}</div>
    {m.restriction && m.state==="open"&&<p className="text-xs text-[var(--color-fg-dim)]">{m.restriction}</p>}
  </section>;
}

function BetLeaderboard({ rows }: { rows: BetBoardDTO["leaderboard"] }) {
  if (!rows.length) return <Empty text="尚无已结算参与，暂无排名" />;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">BET 净收益排行榜，同收益并列排名</caption>
    <thead><tr className="border-b border-[var(--color-border)]">{["排名", "用户", "净收益", "已结算盘口"].map(label => <th key={label} className="px-2 py-3 whitespace-nowrap">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.userId} className="border-b border-[var(--color-border)]">
      <td className="px-2 py-3 tabular-nums">#{row.rank}</td><td className="max-w-32 truncate px-2 py-3" title={row.name}><PlayerProfileLink userId={row.userId}>{row.name}</PlayerProfileLink></td>
      <td className="px-2 py-3 tabular-nums">{BigInt(row.profit)>BigInt(0)?"+":""}{formatPoints(row.profit)}</td><td className="px-2 py-3 tabular-nums">{row.settledCount}</td>
    </tr>)}</tbody></table></div>;
}
function BetRecords({ rows, signedIn }: { rows: BetBoardDTO["records"]; signedIn: boolean }) {
  if (!signedIn) return <Empty text="登录后查看本人积分记录" />;
  if (!rows.length) return <Empty text="暂无积分记录" />;
  return <ol aria-label="本人积分记录" className="divide-y divide-[var(--color-border)]">{rows.map((row, index) => <li key={`${row.createdAt}-${index}`} className="flex items-start justify-between gap-4 py-4">
    <div className="min-w-0 space-y-1"><p className="text-sm">{row.label}</p>{row.context && <p className="break-words text-xs text-[var(--color-fg-mid)]">{row.context}</p>}<time dateTime={row.createdAt} className="text-xs text-[var(--color-fg-dim)]">{formatCSTDateTime(row.createdAt)}</time></div>
    <span className="shrink-0 font-mono tabular-nums">{BigInt(row.amount)>BigInt(0)?"+":""}{formatPoints(row.amount)}</span>
  </li>)}</ol>;
}
