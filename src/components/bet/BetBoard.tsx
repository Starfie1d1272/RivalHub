"use client";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { useClientReady } from "@/components/rivalhub/useClientReady";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { SupportLine } from "./MatchSupport";
import { FreePrediction } from "./FreePrediction";
import { PredictionLeaderboard } from "./PredictionLeaderboard";
import { BetRelief } from "./BetRelief";
import type { FreePredictionModel, FreePredictionControls, PredictionRankingModel, PredictionRankingSort } from "./presentation-contract";
import type { ComponentProps } from "react";
import { BetOptionProfile } from "./BetOptionProfile";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { safeLocalRedirect } from "@/lib/auth/redirect";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HelpTooltip, PageHeader } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { getBetStakeReceipt, mutateBet as telemetry_mutateBet } from "@/actions/bet";
import { betStateLabel, formatPoints } from "@/lib/bet/presentation";
import type { BetBoardDTO, BetMarketDTO } from "@/lib/bet/types";
import { formatCSTDateTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { ErrorCode } from "@/lib/errors";
import { observeAction, beginTelemetryDemand, recordDemandReady, type TelemetryDemandToken } from "@/lib/telemetry/client";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";

const mutateBet = observeAction("bet.mutateBet", telemetry_mutateBet);

const filters=[{key:"open",label:"开放"},{key:"mine",label:"我的投入"},{key:"settled",label:"已结算"},{key:"event",label:"赛事"},{key:"leaderboard",label:"排行榜"},{key:"records",label:"记录"}] as const;
export function BetBoard({initial,slug,signedIn,view,matchFilter,predictions,predictionControls,rankings,relief,predictionMatchRows,rankingRefreshAction,returnSelection,refreshAction,mutationPendingAction,recordsPage=0}:{initial:BetBoardDTO;mutationPendingAction?:(pending:boolean)=>void;refreshAction:()=>Promise<boolean>;recordsPage?:number;slug:string;signedIn:boolean;view:string;matchFilter:string|null;predictions?:FreePredictionModel[];predictionControls?:FreePredictionControls;rankings?:Record<PredictionRankingSort,PredictionRankingModel>;relief?:Omit<ComponentProps<typeof BetRelief>,"onClaimed">;predictionMatchRows?:BetBoardDTO["matches"];rankingRefreshAction?:ComponentProps<typeof PredictionLeaderboard>["refreshAction"];returnSelection?:{market?:string;option?:string;prediction?:string;choice?:string}}) {
  const router=useRouter();const data=initial;const [pending,startTransition]=useTransition();
  const interactive=useClientReady();
  const task=useTelemetryTask("bet",data.seasonId,signedIn&&data.enabled&&(!data.joined?!!data.joinEligibility?.canJoin:data.markets.some(m=>m.canStake)));
  const taskStep=task.step;
  type StakeAttempt={token:string|null;seasonId:string;marketId:string;optionId:string;previousAmount:string};
  const stakeAttempt=useRef<StakeAttempt|null>(null);
  const [receipt,setReceipt]=useState<StakeAttempt|{token:string|null;seasonId:string}|null>(null);
  const [demand,setDemand]=useState<TelemetryDemandToken|null>(null);
  const receiptMarket=receipt&&"marketId" in receipt?data.markets.find(m=>m.id===receipt.marketId):undefined;
  const resultShown=!!receipt&&receipt.seasonId===data.seasonId&&("marketId" in receipt
    ? receiptMarket?.mine?.optionId===receipt.optionId&&BigInt(receiptMarket.mine.amount)>BigInt(receipt.previousAmount)
    : data.joined);
  useEffect(()=>{if(resultShown&&receipt)taskStep("result",receipt.token);},[resultShown,receipt,taskStep]);
  const boardRef=useRef<HTMLDivElement|null>(null);
  const participationTitle=useRef<HTMLHeadingElement|null>(null);
  const participationOpener=useRef<HTMLElement|null>(null);
  const restoreFocusAfterPending=useRef(false);
  const [freePending,setFreePending]=useState(false);
  useEffect(()=>{mutationPendingAction?.(pending||freePending);return ()=>mutationPendingAction?.(false);},[pending,freePending,mutationPendingAction]);
  const interactionBusy=!interactive||pending||freePending;
  const resumedPrediction=signedIn?predictions?.find(p=>p.matchId===matchFilter&&p.kind===returnSelection?.prediction&&p.options.some(o=>o.key===returnSelection.choice)):undefined;
  const resumedMarket=signedIn?(initial.markets.find(m=>m.id===returnSelection?.market&&m.matchId===matchFilter&&m.options.some(o=>o.id===returnSelection.option))??(resumedPrediction?predictionMarket(initial.markets,resumedPrediction,returnSelection!.choice!):undefined)):undefined;
  const resumedOptionId=resumedMarket?.options.find(o=>o.id===returnSelection?.option)?.id??(resumedPrediction?resumedMarket?.options.find(o=>predictionOption(o,resumedPrediction,returnSelection!.choice!))?.id:undefined);
  const [predictionTarget,setPredictionTarget]=useState<{matchId:string;kind:FreePredictionModel["kind"]}|null>(resumedPrediction?{matchId:resumedPrediction.matchId,kind:resumedPrediction.kind}:resumedMarket?.matchId?{matchId:resumedMarket.matchId,kind:resumedMarket.group==="比赛"||resumedMarket.type==="total_rounds"&&initial.matches.find(m=>m.id===resumedMarket.matchId)?.format==="BO1"?"winner":"bp"}:null);
  const [selected,setSelected]=useState<{market:BetMarketDTO;optionId:string}|null>(resumedMarket?{market:resumedMarket,optionId:resumedOptionId!}:null);
  useEffect(()=>{if(restoreFocusAfterPending.current&&!pending&&!freePending&&!selected&&!predictionTarget){restoreFocusAfterPending.current=false;participationOpener.current?.focus();}},[pending,freePending,selected,predictionTarget]);
  const [amount,setAmount]=useState("");const [allIn,setAllIn]=useState(false);const [allConfirmed,setAllConfirmed]=useState(false);
  const [uncertain,setUncertain]=useState<Parameters<typeof getBetStakeReceipt>[0] | null>(null);
  const [requestId,setRequestId]=useState(()=>resumedMarket?crypto.randomUUID():"");const [error,setError]=useState<string|null>(null);
  const matches = [...data.matches, ...(predictionMatchRows ?? []).filter(match => !data.matches.some(row => row.id === match.id))];
  const active=filters.some(f=>f.key===view)?view:"open";
  const predictionMatches = predictions && predictionControls ? matches.filter(match => (!matchFilter || match.id === matchFilter) && predictions.some(panel => panel.matchId === match.id && (active === "mine" ? panel.own.length > 0 : active === "settled" ? panel.officialStatus === "finished" || panel.officialStatus === "cancelled" || panel.status === "void" : active === "open" && (Boolean(matchFilter) || panel.officialStatus !== "finished" && panel.officialStatus !== "cancelled" && panel.status !== "void")))) : [];
  const visible=data.markets.filter(m=>(!matchFilter||m.matchId===matchFilter) && (active==="event"?m.matchId===null:active==="mine"?!!m.mine:active==="settled"?["settled","refunded"].includes(m.state):m.matchId!==null && ["open","locked"].includes(m.state)));
  const loginHref = `/login?next=${encodeURIComponent(`/${slug}/bet?${new URLSearchParams({view: active, ...(matchFilter ? {match: matchFilter} : {})})}`)}` as const;
  function loginFor(selection:Record<string,string>){const query=new URLSearchParams({...selection,view:active});const next=safeLocalRedirect(`/${slug}/bet?${query}`);router.push(`/login?next=${encodeURIComponent(next)}`);}
  function choose(market:BetMarketDTO,optionId:string){if(interactionBusy)return;if(!signedIn){loginFor({...(market.matchId?{match:market.matchId}:{}),market:market.id,option:optionId});return;}setDemand(beginTelemetryDemand("bet"));if(!selected&&!predictionTarget)participationOpener.current=document.activeElement as HTMLElement;setPredictionTarget(market.matchId?{matchId:market.matchId,kind:market.group==="比赛"||market.type==="total_rounds"&&matches.find(m=>m.id===market.matchId)?.format==="BO1"?"winner":"bp"}:null);setSelected({market,optionId});setAmount("");setAllIn(false);setAllConfirmed(false);setRequestId(crypto.randomUUID());setError(null);}
  function join(){if(interactionBusy||!data.joinEligibility?.canJoin)return;const token=task.begin("submit");startTransition(async()=>{try{const r=await mutateBet({operation:"join",seasonId:data.seasonId});if(!r.success){setError(r.error.message);toast.error(r.error.message);return;}task.complete(token);setReceipt({token,seasonId:data.seasonId});setError(null);toast.success("积分已领取");void refreshAction().then(success=>{if(!success)toast.error("积分已领取，余额更新失败，请刷新后查看。");}).catch(()=>toast.error("积分已领取，余额更新失败，请刷新后查看。"));}catch{setError("领取结果暂未确认，请刷新后查看。");}});}
  function refreshCommitted(){void refreshAction().then(success=>{if(!success)toast.error("投入已提交，数据更新失败，请刷新后查看。");}).catch(()=>toast.error("投入已提交，数据更新失败，请刷新后查看。"));}
  function submitted(amount:string){const captured=stakeAttempt.current;if(captured){task.complete(captured.token);setReceipt(captured);}setUncertain(null);toast.success(`已投入 ${formatPoints(amount)} 积分`);setSelected(null);setPredictionTarget(null);setError(null);refreshCommitted();}
  function submit(){
    if(pending||freePending)return;
    if(uncertain){startTransition(async()=>{try{const result=await getBetStakeReceipt(uncertain);if(result.success&&result.data.status==="committed")submitted(result.data.amount);else setError("投入结果仍未确认，请稍后再次核对，暂勿重复投入。");}catch{setError("暂时无法核对投入结果，请稍后再次核对。");}});return;}
    if(!selected||!canStakeSelection)return;
    const payload={operation:"stake" as const,seasonId:data.seasonId,marketId:selected.market.id,optionId:selected.optionId,amount:allIn?"all":amount,requestId};
    stakeAttempt.current={token:task.begin("submit"),seasonId:data.seasonId,marketId:payload.marketId,optionId:payload.optionId,previousAmount:selected.market.mine?.amount??"0"};
    startTransition(async()=>{try{const r=await mutateBet(payload);if(!r.success){if(r.error.code===ErrorCode.INTERNAL_ERROR){setUncertain(payload);setError("投入结果未确认，请核对原请求，暂勿重复投入。");}else setError(r.error.message);return;}submitted(r.data&&"amount" in r.data?r.data.amount:"0");}catch{setUncertain(payload);setError("投入结果未确认，请核对原请求，暂勿重复投入。");}});
  }
  const current=data.markets.find(m=>m.id===selected?.market.id);
  const selectedOption=current?.options.find(o=>o.id===selected?.optionId);
  const canStakeSelection=Boolean(signedIn&&data.joined&&selectedOption&&current?.canStake&&(!current.mine||current.mine.optionId===selected?.optionId));
  const amountValue=allIn?BigInt(data.balance):/^[1-9]\d*$/.test(amount)?BigInt(amount):BigInt(0);
  const canEstimate=current && ["champion","top_fragger","match_winner","exact_score","total_maps","veto_map","veto_first","veto_decider","map_winner","total_rounds"].includes(current.type);
  const estimate=canEstimate && selectedOption && amountValue>BigInt(0)?(BigInt(current!.pool)+amountValue)*amountValue/(BigInt(selectedOption.pool)+amountValue):null;
  const selectedPrediction=predictions?.find(p=>p.matchId===predictionTarget?.matchId&&p.kind===predictionTarget.kind);
  function openPrediction(model:FreePredictionModel,key:string){if(interactionBusy)return;if(!signedIn){loginFor({match:model.matchId,prediction:model.kind,choice:key});return;}setDemand(beginTelemetryDemand("bet"));participationOpener.current=document.activeElement as HTMLElement;const market=predictionMarket(data.markets,model,key);const option=market?.options.find(o=>predictionOption(o,model,key));setSelected(market?{market,optionId:option?.id??""}:null);setPredictionTarget({matchId:model.matchId,kind:model.kind});setAmount("");setAllIn(false);setAllConfirmed(false);setRequestId(crypto.randomUUID());setError(null);}

  const participationOpen=!!selected||!!selectedPrediction;
  useEffect(()=>{if(participationOpen&&interactive)recordDemandReady(demand,"form");},[participationOpen,interactive,demand]);
  function closeParticipation(){if(uncertain)return;setSelected(null);setPredictionTarget(null);setError(null);}
  return <div ref={boardRef} className="space-y-5" aria-busy={interactionBusy}>
    {interactive&&<ContentReady module="bet" phase="primary"/>}
    {matchFilter && <nav aria-label="单场竞猜位置" className="flex flex-wrap gap-4 text-sm text-[var(--color-fg-mid)]"><Link href={`/${slug}/matches/${matchFilter}` as never} className="hover:text-[var(--color-accent)]">← 返回比赛详情</Link><Link href={`/${slug}/bet` as never} className="hover:text-[var(--color-accent)]">全部竞猜 →</Link></nav>}
    <PageHeader title="预测与竞猜" description={<span role="status">{interactive?"免费预测不扣积分":"正在准备操作…"}</span>} actions={<>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Metric label="可用积分" value={data.joined?formatPoints(data.balance):"—"} accent help="首次领取 1,000 积分；加入后的 Main Event 新阶段各补给 300，不补历史阶段。管理员可以参与，但本人参赛队伍相关盘口不可参与。排名按净收益，不按余额；至少一次已结算参与才上榜。使用赛事积分参与无抽水社区奖池。积分不能购买、交易、转账、提现或兑换现实价值；只能追加原选项，不能换边或撤回。无胜方投入、全部投入均获胜或弃权时原额退款。预计回报随奖池变化。"/>
        <Metric label="净收益" value={data.joined?`${BigInt(data.profit)>BigInt(0)?"+":""}${formatPoints(data.profit)}`:"—"}/>
        <Link href={`/${slug}/bet?view=leaderboard`} aria-label="查看 BET 排行榜" className="rounded focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"><Metric label="排名" value={data.rank?`#${data.rank}`:"未上榜"}/></Link>
        {data.joined && relief && <BetRelief {...relief} onClaimed={()=>{void refreshAction().then(success=>{if(!success)toast.error("钱包状态更新失败，请刷新后查看。");});}}/>}
        {data.enabled && !data.joined && (signedIn?data.joinEligibility?.canJoin?<Button onClick={join} disabled={interactionBusy}>领取 1,000 积分</Button>:<span className="text-xs text-[var(--color-fg-mid)]">{data.joinEligibility?.reason??"领取资格暂不可用，请刷新"}</span>:<Button asChild><Link href={loginHref}>登录参与</Link></Button>)}
      </div>
    </>}/>
    {error && !selected && !selectedPrediction && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    {data.paused && <p role="status" className="border-l-2 border-[var(--color-warn)] pl-3 text-sm">投入已暂停，已有投入与结算记录保留。</p>}
    {BigInt(data.debt)>BigInt(0) && <p role="status" className="text-sm text-[var(--color-warn)]">待抵扣 {formatPoints(data.debt)} 积分 <HelpTooltip label="待抵扣积分说明" content="官方结果更正后产生的差额将从后续补给、退款与返还中优先抵扣。"/></p>}
    <nav aria-label="BET 筛选" className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]">
      {filters.map(f=><Link key={f.key} href={`/${slug}/bet${f.key==="open"?"":`?view=${f.key}`}` as never} aria-current={active===f.key?"page":undefined} className={cn("border-b-2 px-3 py-3 text-sm sm:px-4 focus-visible:outline focus-visible:outline-[var(--color-accent)]",active===f.key?"border-[var(--color-accent)] font-semibold text-[var(--color-fg)]":"border-transparent text-[var(--color-fg-mid)]")}>{f.label}</Link>)}
      <span className="ml-auto py-3 text-xs tabular-nums text-[var(--color-fg-dim)]">{visible.filter(m=>m.state==="open").length} 个开放盘口</span>
    </nav>
    {matchFilter && <Link href={`/${slug}/bet` as never} className="inline-block text-sm text-[var(--color-accent)]">查看全部比赛 →</Link>}
    {active==="leaderboard"?(rankings?<PredictionLeaderboard rankings={rankings} refreshAction={rankingRefreshAction}/>:<BetLeaderboard rows={data.leaderboard}/>):active==="records"?<BetRecords rows={data.records} signedIn={signedIn} slug={slug} page={recordsPage} hasMore={data.recordsHasMore??false} nextCursor={data.recordsNextCursor}/>:!visible.length&&!predictionMatches.length?<Empty text={!data.enabled?"BET 尚未开放":active==="mine"?"还没有投入记录":active==="settled"?"暂无已结算盘口":active==="event"?"等待正赛名单确认":"等待下一场对阵或地图"}/>:<div className={cn("grid min-w-0 items-start gap-5",!matchFilter&&"lg:grid-cols-2")}>
      {[...new Set([...visible.map(m=>m.matchId), ...predictionMatches.map(match=>match.id)])].map(id=>{
        const match = matches.find(m=>m.id===id);
        return id&&match?<MatchCard key={id} busy={interactionBusy} match={match} markets={data.markets.filter(m=>m.matchId===id)} slug={slug} choose={choose} initialGroup={resumedMarket?.matchId===id?(resumedMarket.group==="比赛"||resumedMarket.type==="total_rounds"&&match.format==="BO1"?"赛果":"地图"):resumedPrediction?.matchId===id?(resumedPrediction.kind==="winner"?"赛果":"地图"):undefined} predictions={predictions?.filter(panel=>panel.matchId===id)} openPrediction={openPrediction}/>:!id?<section key="event" className="space-y-5 lg:col-span-2">{visible.filter(m=>!m.matchId).map(m=><div key={m.id} className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><MarketRow busy={interactionBusy} market={m} slug={slug} choose={choose}/></div>)}</section>:null;
      })}
    </div>}
    <Dialog open={!!selected||!!selectedPrediction} onOpenChange={open=>{if(!open&&!pending&&!freePending)closeParticipation();}}><DialogContent size="md" onOpenAutoFocus={event=>{event.preventDefault();if(!participationOpener.current)participationOpener.current=Array.from(boardRef.current?.querySelectorAll<HTMLButtonElement>("button")??[]).find(button=>(!!resumedOptionId&&button.dataset.betOption===resumedOptionId)||(!!resumedPrediction&&button.dataset.predictionKey===returnSelection?.choice&&button.dataset.predictionKind===resumedPrediction.kind))??boardRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')??null;participationTitle.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();if(pending||freePending)restoreFocusAfterPending.current=true;else participationOpener.current?.focus();}} onInteractOutside={e=>{if(pending||freePending)e.preventDefault();}} onEscapeKeyDown={e=>{if(pending||freePending)e.preventDefault();}}>
      <DialogHeader><DialogTitle ref={participationTitle} tabIndex={-1}>{selected?.market.title??(selectedPrediction?.kind==="winner"?"赛果预测":"地图预测")}</DialogTitle><DialogDescription>{current?.context && <span>{current.context} · </span>}{current&&selectedOption?optionDisplayLabel(current,selectedOption.label):selectedOption?.label}</DialogDescription></DialogHeader>
      <DialogBody className="space-y-5">{selectedPrediction&&predictionControls&&<div className="border-b border-[var(--color-border)] pb-4"><FreePrediction key={`${selectedPrediction.matchId}-${selectedPrediction.kind}`} model={selectedPrediction} signedIn={signedIn} controls={predictionControls} onPendingChange={setFreePending} disabled={interactionBusy}/></div>}
        <h3 className="flex items-center gap-2 text-sm font-semibold">积分竞猜{selectedOption&&<> · {current?optionDisplayLabel(current,selectedOption.label):selectedOption.label}<BetOptionProfile option={selectedOption} slug={slug}/></>}</h3>
        {current&&selectedOption&&<p className="text-xs text-[var(--color-fg-dim)]">{betStateLabel[current.state]} · {selectedOption.percent.toFixed(0)}% · {formatPoints(selectedOption.pool)} 积分<HelpTooltip label={`${current.title}规则`} content={current.help}/></p>}
        {!current&&<p className="text-sm text-[var(--color-fg-dim)]">暂无对应积分盘口</p>}
        {current&&<>
        {!signedIn?<Button size="sm" asChild><Link href="/login">登录参与积分竞猜</Link></Button>:!data.joined?<div className="space-y-2"><p className="text-sm text-[var(--color-fg-mid)]">先领取本届初始积分，免费预测不受影响。</p>{data.joinEligibility?.canJoin?<Button size="sm" disabled={interactionBusy} onClick={join}>{pending?"领取中…":"领取 1,000 积分"}</Button>:<p role="status" className="text-xs text-[var(--color-fg-mid)]">{data.joinEligibility?.reason??"领取资格暂不可用，请刷新"}</p>}</div>:null}
        {signedIn&&data.joined&&<>
        {current.mine&&current.mine.optionId!==selected?.optionId&&<p role="status" className="border-l-2 border-[var(--color-accent)] pl-3 text-sm">已投入 {current.options.find(o=>o.id===current.mine!.optionId)?.label??"原选项"}，只能向该选项追加；免费预测仍可选任一方。</p>}
        <div className="flex justify-between text-sm"><span className="text-[var(--color-fg-mid)]">可用积分</span><span className="font-mono">{formatPoints(data.balance)}</span></div>
        <div className="space-y-2"><Label htmlFor="bet-amount">投入积分</Label><Input id="bet-amount" inputMode="numeric" value={allIn?data.balance:amount} disabled={interactionBusy||!!uncertain||!canStakeSelection} onChange={e=>{setAmount(e.target.value);setAllIn(false);setAllConfirmed(false);}}/></div>
        <div className="grid grid-cols-4 gap-2">{[10,25,50,100].map(percent=><Button key={percent} size="sm" variant={percent===100&&allIn?"default":"outline"} disabled={interactionBusy||!!uncertain||!canStakeSelection} onClick={()=>{setAmount((BigInt(data.balance)*BigInt(percent)/BigInt(100)).toString());setAllIn(percent===100);setAllConfirmed(false);}}>{percent===100?"ALL IN":`${percent}%`}</Button>)}</div>
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4 text-sm"><span>预计返还 <HelpTooltip label="预计返还说明" content={current?.type==="veto_present"?"三张有效地图共同中奖，按全部中奖投入分配同一个奖池；赛前不提供独胜估算。无人或全部投入中奖时原额退款。":canEstimate?"包含本金，按本次投入后的当前奖池及所选选项独胜估算；最终返还取决于锁盘时奖池，并列胜者共同分配。":"此盘口不提供独胜估算，最终返还由锁盘奖池及有效中奖选项共同决定。"}/></span><span className="font-mono text-[var(--color-accent)]">{estimate?`≈ ${formatPoints(estimate.toString())}`:"—"}</span></div>
        {allIn && <Label className="flex items-start gap-2 text-sm leading-5"><input type="checkbox" checked={allConfirmed} disabled={interactionBusy} onChange={e=>setAllConfirmed(e.target.checked)}/>确认投入全部可用积分，不能撤回</Label>}
        {current && signedIn&&data.joined&&!current.canStake && <p role="status" className="text-sm text-[var(--color-warn)]">{current.restriction??"盘口暂不可投入"}</p>}
        </>}
        {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      </>}</DialogBody><DialogFooter><Button variant="ghost" disabled={interactionBusy||!!uncertain} onClick={closeParticipation}>取消</Button>{current&&signedIn&&data.joined&&<Button disabled={interactionBusy || !uncertain && (!canStakeSelection || amountValue<=BigInt(0) || amountValue>BigInt(data.balance) || allIn&&!allConfirmed)} onClick={submit}>{pending?"提交中…":uncertain?"核对投入结果":"确认投入"}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
function Metric({label,value,accent=false,help}:{label:string;value:string;accent?:boolean;help?:string}){return <div><p className="mb-1 text-xs text-[var(--color-fg-mid)]"><span className="relative inline-block">{label}{help&&<HelpTooltip className="absolute -right-3 top-0" label="BET 积分规则" content={help}/>}</span></p><p className={cn("font-mono text-2xl font-semibold tabular-nums",accent&&"text-[var(--color-accent)]")}>{value}</p></div>;}
function Empty({text}:{text:string}){return <div className="border border-dashed border-[var(--color-border)] py-16 text-center text-sm text-[var(--color-fg-mid)]">{text}</div>;}
function MatchCard({match,markets,slug,choose,predictions,openPrediction,initialGroup,busy}:{busy:boolean;initialGroup?:string;match:BetBoardDTO["matches"][number];markets:BetMarketDTO[];slug:string;choose:(m:BetMarketDTO,o:string)=>void;predictions?:FreePredictionModel[];openPrediction:(model:FreePredictionModel,key:string)=>void}) {
  const tabId=useId();const tabButtons=useRef<(HTMLButtonElement|null)[]>([]);
  const winner=predictions?.find(p=>p.kind==="winner");const bp=predictions?.find(p=>p.kind==="bp");
  const groups=[...(markets.some(m=>m.group==="比赛"||match.format==="BO1"&&m.type==="total_rounds")||winner?["赛果"]:[]),...(markets.some(m=>m.group!=="比赛"&&!(match.format==="BO1"&&m.type==="total_rounds"))||bp?["地图"]:[])];const defaultGroup=groups[0]??"赛果";
  const [group,setGroup]=useState<string|null>(initialGroup??null);const shown=group && groups.includes(group)?group:defaultGroup;
  const completed=match.status==="finished"||winner?.officialStatus==="finished";
  const closed=completed||match.status==="cancelled"||winner?.officialStatus==="cancelled";
  const categoryMarkets=preferredMarkets(markets).filter(m=>shown==="赛果"?m.group==="比赛":m.group!=="比赛"&&!(match.format==="BO1"&&m.type==="total_rounds"));
  const primary=categoryMarkets.find(m=>shown==="赛果"?m.type==="match_winner":m.type.startsWith("veto_"))??categoryMarkets[0];
  // Public DTO order is createdAt/id ascending; reverse preserves a deterministic
  // newest-first fallback while an open/locked market takes priority over history.
  const rounds=match.format==="BO1"&&shown==="赛果"?markets.filter(m=>m.type==="total_rounds").reverse():[];
  const primaryRounds=rounds.find(m=>m.state==="open")??rounds.find(m=>m.state==="locked")??rounds[0];
  const secondary=[...categoryMarkets.filter(m=>m.id!==primary?.id),...rounds.filter(m=>m.id!==primaryRounds?.id)];
  const votesA=winner?.options.find(o=>o.key===match.entryAId)?.count;const votesB=winner?.options.find(o=>o.key===match.entryBId)?.count;
  const hasVotes=Boolean(winner&&winner.participants>0&&votesA!==null&&votesA!==undefined&&votesB!==null&&votesB!==undefined&&votesA+votesB===winner.participants);
  const winnerMarket=preferredMarkets(markets).find(m=>m.type==="match_winner");
  const supportMarket=shown==="赛果"?winnerMarket:primary;
  const panel=shown==="赛果"?winner:bp;
  const canExplore=!closed&&panel?.status==="open";
  const betA=supportMarket?.options.find(o=>o.entity?.kind==="team"&&o.entity.entryId===match.entryAId);const betB=supportMarket?.options.find(o=>o.entity?.kind==="team"&&o.entity.entryId===match.entryBId);
  const hasPool=Boolean(supportMarket&&BigInt(supportMarket.pool)>BigInt(0)&&betA&&betB&&BigInt(betA.pool)+BigInt(betB.pool)===BigInt(supportMarket.pool));
  return <article className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-panel)]">
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-fg-mid)]"><span className="font-mono tracking-wider">{match.stage} · {match.format}</span>{completed&&<span>{markets.some(m=>m.state==="locked")?"完赛 · 待结算":"已完赛"}</span>}<span className="ml-auto">{match.scheduledAt?formatCSTDateTime(match.scheduledAt):"待排期"}</span><Link aria-label={`查看 ${match.a} 对 ${match.b} 比赛`} className="text-[var(--color-fg-dim)] hover:text-[var(--color-accent)]" href={`/${slug}/matches/${match.id}` as never}><ArrowUpRight size={16}/></Link></div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 p-5"><TeamProfileLink seasonSlug={slug} entryId={match.entryAId} className="flex min-w-0 flex-col items-center gap-2 text-center"><TeamLogo logoUrl={match.logoA} teamName={match.a}/><h2 className="w-full truncate text-base font-semibold" title={match.a}>{match.a}</h2></TeamProfileLink><span className="font-mono text-sm text-[var(--color-fg-dim)]">{completed&&match.displayScore?.scoreA!==null&&match.displayScore?.scoreA!==undefined&&match.displayScore.scoreB!==null?`${match.displayScore.scoreA} : ${match.displayScore.scoreB}`:"VS"}</span><TeamProfileLink seasonSlug={slug} entryId={match.entryBId} className="flex min-w-0 flex-col items-center gap-2 text-center"><TeamLogo logoUrl={match.logoB} teamName={match.b}/><h2 className="w-full truncate text-base font-semibold" title={match.b}>{match.b}</h2></TeamProfileLink></div>
    <div className="flex gap-4 border-b border-[var(--color-border)] px-5" role="tablist" aria-label="盘口类别">{groups.map((g,index)=><button ref={element=>{tabButtons.current[index]=element;}} id={`${tabId}-${index}`} aria-controls={`${tabId}-panel`} tabIndex={shown===g?0:-1} onKeyDown={event=>{const next=event.key==="ArrowRight"?(index+1)%groups.length:event.key==="ArrowLeft"?(index+groups.length-1)%groups.length:event.key==="Home"?0:event.key==="End"?groups.length-1:null;if(next!==null){event.preventDefault();setGroup(groups[next]!);tabButtons.current[next]?.focus();}}} key={g} type="button" role="tab" disabled={busy} aria-selected={shown===g} onClick={()=>setGroup(g)} className={cn("border-b-2 py-2 text-sm focus-visible:outline focus-visible:outline-[var(--color-accent)]",shown===g?"border-[var(--color-accent)] text-[var(--color-fg)]":"border-transparent text-[var(--color-fg-mid)]")}>{g}{markets.some(m=>(m.group==="比赛"?"赛果":"地图")===g&&m.state==="open")&&<span aria-hidden className="ml-1.5 text-[var(--color-accent)]">·</span>}</button>)}</div>
    <div className="divide-y divide-[var(--color-border)] px-5" role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${groups.indexOf(shown)}`}>
      {shown==="赛果"&&winner?<div className="space-y-2.5 py-3">
        <SupportLine compact label="人数支持" teamA={match.a} teamB={match.b} left={hasVotes?votesA!/winner.participants*100:null} right={hasVotes?votesB!/winner.participants*100:null} summary={winner.participants>0?`${winner.participants} 人预测`:"暂无预测"} help="按有效免费赛果预测人数计算，每人一票；免费与积分竞猜独立，可以选择不同队伍。"/>
        <SupportLine compact label="积分支持" teamA={match.a} teamB={match.b} left={hasPool?betA!.percent:null} right={hasPool?betB!.percent:null} summary={supportMarket&&BigInt(supportMarket.pool)>BigInt(0)?`${formatPoints(supportMarket.pool)} 积分 · ${supportMarket.participants} 人投入`:"暂无投入"} help="按双方投入积分占奖池总积分计算，与上行人数支持率的分母不同；不是获胜概率。"/>
      </div>:(shown==="赛果"?winner:bp)&&<p className="flex justify-between gap-2 pt-3 text-xs text-[var(--color-fg-dim)]"><span>免费预测</span><span>{(shown==="赛果"?winner:bp)!.participants} 人</span></p>}
      {panel?.own.length ? <PredictionResult model={panel}/> : null}
      {primary&&<div className="py-4"><MarketRow busy={busy} market={primary} slug={slug} choose={choose} explore={canExplore} readOnly={closed||!primary.canStake&&!canExplore} compact={shown==="赛果"&&primary.type==="match_winner"&&!!winner}/></div>}
      {!primary&&panel&&<div className="grid grid-cols-2 gap-2 py-4">{panel.options.map(option=>{
        const content=<span className="flex min-w-0 items-center gap-1"><span className="truncate">{option.label}</span>{panel.own.includes(option.key)&&<Check size={12} className="shrink-0 text-[var(--color-accent)]"/>}</span>;
        const style="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel-low)] p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
        return canExplore?<button data-prediction-key={option.key} data-prediction-kind={panel.kind} disabled={busy} key={option.key} type="button" className={style} onClick={()=>openPrediction(panel,option.key)}>{content}</button>:<div key={option.key} className={style}>{content}</div>;
      })}</div>}

      {secondary.length>0&&<details key={shown} className="py-3"><summary className="cursor-pointer text-xs text-[var(--color-fg-mid)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">{shown==="赛果"?"更多赛果竞猜":"逐图与历史盘口"} · {secondary.length}</summary><div className="space-y-4 pt-4">{secondary.map(m=><MarketRow key={m.id} busy={busy} market={m} slug={slug} choose={choose} explore={canExplore} readOnly={closed||!m.canStake&&!canExplore}/>)}</div></details>}

      {primaryRounds&&<div className="py-4"><MarketRow busy={busy} market={primaryRounds} slug={slug} choose={choose} explore={canExplore} readOnly={closed||!primaryRounds.canStake&&!canExplore}/></div>}
    </div>
  </article>;
}
function MarketRow({market:m,choose,slug,explore=false,compact=false,busy=false,readOnly=false}:{readOnly?:boolean;busy?:boolean;compact?:boolean;explore?:boolean;slug:string;market:BetMarketDTO;choose:(m:BetMarketDTO,o:string)=>void}) {
  const [search,setSearch]=useState("");
  const isReadOnly=readOnly||!m.canStake&&!explore;
  const options=m.options.filter(o=>o.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section aria-label={m.title} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{m.title}</h3><HelpTooltip label={`${m.title}规则`} content={m.help}/>{m.context&&<span className="text-xs text-[var(--color-fg-dim)]">{m.context}</span>}</div><span className={cn("flex items-center gap-1 text-xs",m.state==="open"?"text-[var(--color-accent)]":"text-[var(--color-fg-dim)]")}>{m.state==="locked"&&<LockKeyhole size={11}/>} {betStateLabel[m.state]}</span></div>
    {m.options.length>16 && <Input disabled={busy} aria-label={`搜索${m.title}选项`} placeholder="搜索队伍或选手" value={search} onChange={e=>setSearch(e.target.value)}/>}
    <div className={cn("grid gap-2",m.options.length>16&&"max-h-96 overflow-y-auto",m.options.length>6?"grid-cols-2 sm:grid-cols-4":m.options.length>2?"grid-cols-2 sm:grid-cols-4":"grid-cols-2")}>{options.map((o,index)=>{
      const own=m.mine?.optionId===o.id;const can=m.canStake && (!m.mine || own);
      const optionClass=cn(compact&&(index===0?"text-[var(--color-accent)]":"text-[var(--color-accent-b)]"),"relative flex-1 min-w-0 overflow-hidden border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-default",own||o.winner?"border-[var(--color-accent)] bg-[var(--color-panel-hi)]":"border-[var(--color-border)] bg-[var(--color-panel-low)]",can&&"hover:border-[var(--color-accent)]");
      const content=<>
        <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-[var(--color-accent)] opacity-50" style={{width:`${o.percent}%`}}/>
        <span className="flex items-center gap-1 text-sm"><span className="truncate" title={optionDisplayLabel(m,o.label)}>{optionDisplayLabel(m,o.label)}</span>{(own||o.winner)&&<Check size={12} className="shrink-0 text-[var(--color-accent)]"/>}</span>{!compact&&<span className="mt-1 flex flex-wrap justify-between gap-1 text-xs font-mono tabular-nums text-[var(--color-fg-mid)]"><span>{o.percent.toFixed(0)}%</span><span>{formatPoints(o.pool)}</span></span>}
      </>;
      return <div key={o.id} className="flex min-w-0 items-center gap-1">{isReadOnly?<div className={optionClass}>{content}</div>:<button data-bet-option={o.id} type="button" disabled={busy||!can&&!explore} onClick={()=>choose(m,o.id)} className={optionClass}>{content}</button>}<BetOptionProfile option={o} slug={slug}/></div>;
    })}</div>
    {!options.length && <p className="text-sm text-[var(--color-fg-mid)]">没有匹配的选项</p>}
    {!compact&&<div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-fg-dim)]"><span>奖池 <span className="font-mono text-[var(--color-fg-mid)]">{formatPoints(m.pool)}</span> · {m.participants} 人</span>{m.mine&&<span className="text-[var(--color-fg-mid)]">已投 {formatPoints(m.mine.amount)}{m.mine.payout!==null&&<> → {formatPoints(m.mine.payout)} <span className="font-mono text-[var(--color-accent)]">{BigInt(m.mine.profit??"0")>BigInt(0)?"+":""}{formatPoints(m.mine.profit??"0")}</span></>}</span>}</div>}
    {compact&&<div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-fg-mid)]">{!isReadOnly&&<span>点队名 · 免费预测 / 积分竞猜</span>}{m.mine&&<span>已投 {formatPoints(m.mine.amount)}{m.mine.payout!==null&&<> → {formatPoints(m.mine.payout)}</>}</span>}</div>}
    {isReadOnly&&m.mine&&<p className="text-xs text-[var(--color-fg-mid)]">我的积分：{m.options.find(o=>o.id===m.mine!.optionId)?.label} · {m.state==="refunded"?"已退款":m.state==="settled"?m.options.find(o=>o.id===m.mine!.optionId)?.winner?"已命中":"未命中":"待结算"}</p>}
    {m.restriction && m.state==="open"&&<p className="text-xs text-[var(--color-fg-dim)]">{m.restriction}</p>}
  </section>;
}

function BetLeaderboard({ rows }: { rows: BetBoardDTO["leaderboard"] }) {
  if (!rows.length) return <Empty text="尚无已结算参与，暂无排名" />;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">BET 净收益排行榜，同收益并列排名</caption>
    <thead><tr className="border-b border-[var(--color-border)]">{["排名", "用户", "净收益", "已结算盘口"].map(label => <th key={label} className="px-2 py-3 whitespace-nowrap">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.userId} className="border-b border-[var(--color-border)]">
      <td className="px-2 py-3 tabular-nums">#{row.rank}</td><td className="max-w-32 truncate px-2 py-3" title={row.name}>{row.playerUserId ? <PlayerProfileLink userId={row.playerUserId}>{row.name}</PlayerProfileLink> : row.name}</td>
      <td className="px-2 py-3 tabular-nums">{BigInt(row.profit)>BigInt(0)?"+":""}{formatPoints(row.profit)}</td><td className="px-2 py-3 tabular-nums">{row.settledCount}</td>
    </tr>)}</tbody></table></div>;
}
function BetRecords({ rows, signedIn, slug, page, hasMore, nextCursor }: { nextCursor?:string; rows: BetBoardDTO["records"]; signedIn: boolean; slug:string; page:number; hasMore:boolean }) {
  if (!signedIn) return <Empty text="登录后查看本人积分记录" />;
  return <>{!rows.length&&<Empty text="暂无积分记录"/>}<ol aria-label="本人积分记录" className="divide-y divide-[var(--color-border)]">{rows.map((row, index) => <li key={`${row.createdAt}-${index}`} className="flex items-start justify-between gap-4 py-4">
    <div className="min-w-0 space-y-1"><p className="text-sm">{row.label}</p>{row.context && <p className="break-words text-xs text-[var(--color-fg-mid)]">{row.context}</p>}<time dateTime={row.createdAt} className="text-xs text-[var(--color-fg-dim)]">{formatCSTDateTime(row.createdAt)}</time></div>
    <span className="shrink-0 font-mono tabular-nums">{BigInt(row.amount)>BigInt(0)?"+":""}{formatPoints(row.amount)}</span>
  </li>)}</ol><nav aria-label="积分记录翻页" className="flex justify-between text-sm">{page>0?<Link href={`/${slug}/bet?view=records&page=${page-1}` as never}>上一页</Link>:<span/>}{hasMore&&<Link href={`/${slug}/bet?view=records&page=${page+1}${nextCursor?`&cursor=${encodeURIComponent(nextCursor)}`:""}` as never}>下一页</Link>}</nav></>;
}

function PredictionResult({model}:{model:FreePredictionModel}) {
  const selection=model.own.map(key=>model.options.find(option=>option.key===key)?.label??"原选项").filter(Boolean).join("、");
  return <p className="py-3 text-xs text-[var(--color-fg-mid)]">我的免费{model.kind==="winner"?"赛果":" BP"}：{selection} · {model.status==="void"?"已作废":model.result?model.result.hit?"已命中":`未命中${model.kind==="bp"?` · ${model.result.matched}/${model.result.total}`:""}`:"待评判"}</p>;
}
function preferredMarkets(markets:BetMarketDTO[]) { const states=["open","locked","settled","refunded"];return [...markets].reverse().sort((a,b)=>states.indexOf(a.state)-states.indexOf(b.state)); }
function predictionOption(option:BetMarketDTO["options"][number],model:FreePredictionModel,key:string){return model.kind==="winner"?option.entity?.kind==="team"&&option.entity.entryId===key:option.label===model.options.find(p=>p.key===key)?.label;}
function predictionMarket(markets:BetMarketDTO[],model:FreePredictionModel,key:string){return preferredMarkets(markets).filter(m=>m.matchId===model.matchId&&(model.kind==="winner"?m.type==="match_winner":m.type.startsWith("veto_"))&&m.options.some(o=>predictionOption(o,model,key)))[0];}

function optionDisplayLabel(market:BetMarketDTO,label:string){const threshold=market.type==="total_rounds"?market.title.match(/ · (\d+(?:\.\d+)?)$/)?.[1]:undefined;return threshold&&["大","小"].includes(label)?`${label==="大"?"大于":"小于"}${threshold}`:label;}
