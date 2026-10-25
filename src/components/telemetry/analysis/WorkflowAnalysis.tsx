"use client";
import { useEffect, useState, startTransition } from "react";
import { getTelemetryWorkflowsAction } from "@/app/admin/telemetry/actions";
import type { WorkflowData } from "@/lib/admin/product-experience/contract";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { Empty, Heading, Pick, Series, Stat, duration, number } from "./Elements";

export function WorkflowAnalysis({ events }: { events: { value: string; label: string }[] }) {
  const [days, setDays] = useState("7");
  const [eventId, setEvent] = useState("");
  const [data, setData] = useState<WorkflowData | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    startTransition(async () => { try {
      const result = await getTelemetryWorkflowsAction({ days, eventId });
      if (cancelled) return;
      if (result.status === "ready") setData(result.data); else setError(true);
    } catch { if (!cancelled) setError(true); } });
    return () => { cancelled = true; };
  }, [days, eventId, refresh]);
  return <div className="space-y-4"><Panel contentClassName="p-4"><Heading title="多人流程周期" note="来自业务记录；独立使用下方时间与赛事条件，包含协作和审核等待。" />
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><Pick label="流程时间范围" value={days} all={false} options={[{ value: "7", label: "最近 7 天" }, { value: "28", label: "最近 28 天" }, { value: "90", label: "最近 90 天" }]} onChange={v => { setData(null); setError(false); setDays(v); }} /><Pick label="流程赛事" value={eventId} options={events} onChange={v => { setData(null); setError(false); setEvent(v); }} /><Button variant="outline" className="self-end" onClick={() => { setData(null); setError(false); setRefresh(n => n + 1); }}>刷新流程记录</Button></div>
  </Panel>{error ? <Panel><Empty>暂时无法读取业务记录，请重试。</Empty></Panel> : !data ? <Panel><Empty>正在读取业务流程…</Empty></Panel> : <><Panel contentClassName="p-0"><Heading title="赛后资料齐备" note={data.postmatch.note} /><div className="grid grid-cols-2 md:grid-cols-4"><Stat label="窗口内正式完赛" value={data.postmatch.finished} /><Stat label="当前已齐备" value={data.postmatch.ready} /><Stat label="仍有待办" value={data.postmatch.pending} /><Stat label="撤回后待重提" value={data.postmatch.reopened} /></div>{data.postmatch.missingCompletionTime > 0 && <p className="p-4 text-xs text-muted-foreground">另有 {data.postmatch.missingCompletionTime} 场缺少完赛时间，未归入窗口。</p>}</Panel>{data.rows.map(row => <Panel key={row.key} contentClassName="p-0"><Heading title={row.label} note={`${row.source} · ${row.note}`} />
    <div className="grid grid-cols-2 md:grid-cols-4"><Stat label="窗口内发起" value={number(row.started)} /><Stat label="已处理" value={number(row.resolved)} note={`其中通过 / 完成 ${row.approved}`} /><Stat label="仍在等待" value={number(row.waiting)} note={`最久已等 ${duration(row.oldestWaitingMs)}`} /><Stat label="已处理周期 P50" value={duration(row.p50)} note={row.missingTiming ? `${row.missingTiming} 条缺少完整时间` : row.resolved >= 20 ? `P90 ${duration(row.p90)}` : `${row.resolved} 样本 · 少量样本`} /></div>
    <div className="p-4"><Series title="按发起日期观察处理周期" note="各日期显示截至本次查询的结果；较新的流程可能仍在等待。" label="P50" secondaryLabel="P90" format={duration} points={row.trend.map(p => ({ at: Date.parse(p.day + "T00:00:00+08:00"), value: p.p50, secondary: p.resolved >= 20 ? p.p90 : null, n: p.resolved }))} /></div>
  </Panel>)}</>}</div>;
}
