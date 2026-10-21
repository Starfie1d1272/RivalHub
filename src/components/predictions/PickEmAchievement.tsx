"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Check, ChevronDown, Maximize2, Trophy } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPredictionBoard } from "@/actions/predictions";
import { predictionChallengeCapacity } from "@/lib/predictions/rules";
import { stageTasks, type PickEmTaskState } from "@/lib/predictions/achievements";
import type { PickEmBoardData } from "@/lib/predictions/data";
import { COIN_FINISHES, coinFaces } from "./coin-assets";
import styles from "./achievement.module.css";

const Coin3D = dynamic(() => import("./PickEmCoin3D"), { ssr: false, loading: () => <p role="status" className="m-auto text-sm">正在加载纪念币…</p> });
const taskLabels: Record<PickEmTaskState, string> = { complete: "已完成", submitted: "已提交", active: "进行中", upcoming: "未开放", missed: "已错过", failed: "未达标", void: "已作废" };
type Section = "tasks" | "ranking";

export function PickEmAchievement({ data, signedIn }: { data: PickEmBoardData; signedIn: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState<Section>("tasks");
  const [popover, setPopover] = useState<Section | null>(null);
  const [record, setRecord] = useState<PickEmBoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const achievement = (expanded || popover ? record?.achievement : null) ?? data.achievement;
  const coin = achievement?.coin ?? "未获得";
  const finish = COIN_FINISHES[coin] ?? COIN_FINISHES.未获得!;
  const capacity = predictionChallengeCapacity(data.base.stages);
  const stages = achievement?.progress ?? data.base.stages.map((stage) => ({ key: stage.key, name: stage.name,
    tasks: stageTasks({ type: stage.type, target: data.rules.swissTarget, submitted: false, locked: false, closed: false,
      available: data.contests.some(contest => contest.stageKey === stage.key && !contest.locked), voided: false, result: null }) }));
  async function refresh() {
    const id = ++request.current; setLoading(true); setError(false);
    try {
      const result = await getPredictionBoard({ seasonId: data.base.seasonId, view: "record" });
      if (id !== request.current) return;
      if (result.success) setRecord(result.data); else setError(true);
    } catch { if (id === request.current) setError(true); }
    finally { if (id === request.current) setLoading(false); }
  }
  const rows = record?.pickLeaderboard ?? [];
  const mine = rows.find((row) => row.isMe);
  const taskList = <div className={styles.tasks}>
    {stages.map((stage) => <section key={stage.key}>
      <h3>{stage.name}</h3>
      <ul>{stage.tasks.map((task) => <li key={task.key} data-complete={task.state === "complete"}>
        <span className={styles.taskIcon}>{task.state === "complete" ? <Check size={15} aria-hidden="true" /> : <span aria-hidden="true">○</span>}</span>
        <span className="min-w-0 flex-1">{task.label}</span>
        <span className={styles.taskState}>{task.progress !== null && task.target > 1 ? `${task.progress}/${task.target} · ` : ""}{taskLabels[task.state]}</span>
      </li>)}</ul>
    </section>)}
    <p className={styles.rule}>铜币：首次有效提交锁定 · 银 {data.rules.silver} / 金 {data.rules.gold} / 钻 {data.rules.diamond}</p>
    {!signedIn && <p className={styles.rule}>登录后记录你的挑战进度</p>}
  </div>;
  const ranking = <div className={styles.ranking}>
    {mine && <p className={styles.myRank}>我的排名 <strong>#{mine.rank}</strong><span>{mine.value} 项挑战</span></p>}
    <div className={styles.rankHead}><span>排名 / 观众</span><span>完成任务</span></div>
    {rows.length ? <ol>{rows.slice(0, 100).map((row, i) => <li key={`${row.rank}-${i}`} data-me={row.isMe}>
      <span className={styles.rankNumber}>{row.rank}</span><span className="min-w-0 flex-1 truncate">{row.name}{row.isMe && "（我）"}</span><strong>{row.value}<small>/{capacity}</small></strong>
    </li>)}</ol> : !loading && !error ? <p className={styles.empty}>等待首位挑战者</p> : null}
  </div>;
  const status = error ? <button type="button" className={styles.retry} onClick={() => void refresh()}>加载失败，点击重试</button> : loading ? <p className={styles.loading} role="status">正在更新…</p> : null;
  return <Dialog open={expanded} onOpenChange={(open) => { setExpanded(open); if (open) { setPopover(null); void refresh(); } }}>
    <div className={styles.widget} data-testid="pickem-achievement">
      <div className={styles.summary}>
        <div className={styles.coinThumb}>
          <Image src={coinFaces(coin).front} alt={finish.label} width={64} height={64} />
        </div>
        <div className={styles.summaryText}><span>{finish.label}</span><strong>{achievement?.challenges ?? 0}<small> / {capacity}</small></strong></div>
        <DialogTrigger asChild><button type="button" className={styles.expand} aria-label="放大我的纪念币"><Maximize2 size={16} /></button></DialogTrigger>
      </div>
      <div className={styles.actions}>{(["ranking", "tasks"] as const).map((key) => <Popover.Root key={key} open={popover === key} onOpenChange={(open) => { setPopover(open ? key : null); if (open) { setSection(key); void refresh(); } }}>
        <Popover.Trigger asChild><button type="button">{key === "tasks" ? "任务" : "排行榜"}<ChevronDown size={12} aria-hidden="true" /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content align="end" sideOffset={8} collisionPadding={12} className={styles.popover} aria-label={key === "tasks" ? "任务列表" : "排行榜"}>
          <div className={styles.panelTitle}><strong>{key === "tasks" ? "挑战任务" : "排行榜"}</strong><button type="button" aria-label="放大成就面板" onClick={() => { setPopover(null); setExpanded(true); }}><Maximize2 size={15} /></button></div>
          {status}{key === "tasks" ? taskList : ranking}
        </Popover.Content></Popover.Portal>
      </Popover.Root>)}</div>
    </div>
    <DialogContent size="immersive" className={styles.dialog}>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Trophy size={18} aria-hidden="true" />我的纪念币</DialogTitle></DialogHeader>
      <DialogBody className={styles.expandedBody}>
        <section className={styles.coinStage} aria-label="纪念币特写">
          <div className={styles.coinTitle}><span>{data.base.name}</span><h2>{finish.label}</h2><p>{achievement?.challenges ?? 0} / {capacity} 项挑战</p></div>
          {expanded && <Coin3D coin={coin} />}
        </section>
        <Tabs value={section} onValueChange={(value) => setSection(value as Section)} className={styles.detailPanel}>
          <TabsList className="w-full"><TabsTrigger value="tasks" className="flex-1">任务</TabsTrigger><TabsTrigger value="ranking" className="flex-1">排行榜</TabsTrigger></TabsList>
          {status}<TabsContent value="tasks">{taskList}</TabsContent><TabsContent value="ranking">{ranking}</TabsContent>
        </Tabs>
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
