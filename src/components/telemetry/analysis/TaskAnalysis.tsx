"use client";
import { useState } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import type { AnalysisFilters } from "@/lib/telemetry/analysis-query";
import { TASKS, type TaskName } from "@/lib/telemetry/task-contract";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { Empty, Heading, Pick, Series, SmallSample, Stat, duration, number } from "./Elements";

type Props = { data: Analysis; update: (key: keyof AnalysisFilters, value: string) => void };
export function TaskAnalysis({ data, update }: Props) {
  const [clock, setClock] = useState("elapsed");
  const task = data.product.tasks.find(t => t.key === data.filters.task);
  const operation = data.product.operationTrends.find(o => o.operation === data.filters.operation) ?? data.product.operationTrends[0];
  return <div className="space-y-4">
    <Panel contentClassName="p-0"><Heading title="用户任务" note="先查看单项任务，再定位具体操作。浏览与提交分别统计。" />
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">任务</th><th>访问</th><th>操作调用</th><th>成功 / 拒绝</th><th>任务尝试</th><th>已完成 / 成熟尝试</th><th className="pr-4">典型完成用时</th></tr></thead><tbody>
        {data.product.tasks.map(t => <tr key={t.key} className={`border-t border-border ${t.key === data.filters.task ? "bg-secondary" : ""}`}><td className="p-4"><button className="text-left hover:text-primary focus-visible:outline" onClick={() => update("task", t.key)}>{t.label} ↗</button></td>
          <td className="tabular-nums">{number(t.views)}</td><td className="tabular-nums">{number(t.start)}</td><td className="tabular-nums">{number(t.success)} / {number(t.rejected)}</td><td className="tabular-nums">{t.attempts ? number(t.attempts) : "—"}</td>
          <td className="tabular-nums">{t.matured ? `${number(t.maturedCompleted)} / ${number(t.matured)}` : "—"}</td><td className="pr-4 tabular-nums">{duration(t.elapsed.p50)}</td></tr>)}
      </tbody></table></div>{!data.product.tasks.length && <Empty />}
    </Panel>
    {task ? <>
      <Panel contentClassName="p-0"><Heading title={task.label} note={<>任务观察窗口 {duration(task.windowMs)} · 定义 v{task.definitionVersion}</>} action={<Button variant="ghost" size="sm" onClick={() => update("task", "")}>全部任务</Button>} />
        {task.attempts ? <div className="grid grid-cols-2 md:grid-cols-4">
          <Stat label="已开始尝试" value={number(task.attempts)} />
          <Stat label="观察窗口内完成" value={task.completionPct == null ? "—" : `${number(task.completionPct)}%`} note={`${task.maturedCompleted} / ${task.matured} 个成熟尝试`} help="按尝试开始时间归属。观察窗口已结束的尝试进入分母；完成也必须发生在该窗口内。" />
          <Stat label="仍在观察" value={number(task.inProgress)} />
          <Stat label="未观测到完成" value={number(task.unobserved)} note={`另有 ${task.cancelled} 次明确取消`} />
        </div> : <Empty>当前范围尚无关联的任务尝试；下方仍可查看各次调用的结果和耗时。</Empty>}
      </Panel>
      <Panel contentClassName="grid grid-cols-2 md:grid-cols-4 p-0"><Stat label="明确可参与曝光" value={task.eligibleExposures} note={`${task.eligibleSessions} 个会话；仅已接入资格判断的入口`} /><Stat label="使用账号" value={task.repeatUsage.accounts} /><Stat label="不同日再次使用" value={task.repeatUsage.repeatedAccounts} note="仅当前七天内窗口，不作为长期留存率" /><Stat label="未关联账号的使用报告" value={task.repeatUsage.unlinkedReports} /></Panel>
      {task.validations.length > 0 && <Panel contentClassName="p-0"><Heading title="填写与校验阻碍" note="固定原因分类；不采集输入内容。" /><div className="divide-y divide-border">{task.validations.map(v => <p key={v.reason} className="p-4 text-sm">{v.label} · {v.reports} 次报告 / {v.attempts} 个尝试</p>)}</div></Panel>}
      {task.attempts > 0 && <>
        <div className="grid gap-4 xl:grid-cols-2">
          <Series title="任务完成趋势" note="成熟尝试的完成率；展开查看每桶分母" label="完成率" format={v => v == null ? "—" : `${number(v)}%`} points={task.trend.map(p => ({ at: p.at, value: p.completionPct, n: p.matured }))} />
          <div className="space-y-2"><div className="flex gap-2">{[["elapsed", "经过时间"], ["active", "活跃操作时间"]].map(([v, l]) => <Button key={v} size="sm" variant={clock === v ? "secondary" : "ghost"} onClick={() => setClock(v)}>{l}</Button>)}</div>
            <Series title="完成用时趋势" label="P50" secondaryLabel="P90" note="仅成熟尝试中的完成样本；结合完成率观察" format={duration} points={task.trend.map(p => { const s = clock === "active" ? p.active : p.elapsed; return { at: p.at, value: s.p50, secondary: s.n >= 20 ? s.p90 : null, n: s.n }; })} />
          </div>
        </div>
        <Panel contentClassName="p-0"><Heading title="任务步骤" note="各步骤按尝试去重；可选路径与重试可能跳过或重复步骤。" /><div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">{task.steps.map(step => <div key={step.key} className="bg-background p-4"><p className="text-xs text-muted-foreground">{step.label}</p><p className="mt-2 text-xl tabular-nums">{number(step.reached)} <span className="text-xs text-muted-foreground">次尝试</span></p><p className="mt-2 text-xs text-muted-foreground">到达用时 P50 {duration(step.elapsed.p50)}</p></div>)}</div></Panel>
      </>}
    </> : <p className="text-sm text-muted-foreground">选择一项任务查看步骤、完成用时与相关操作。</p>}
    <Panel contentClassName="p-0"><Heading title="单次操作响应" note="从调用开始到收到结果；成功与拒绝、结果未知分别计算耗时。" action={<div className="w-64"><Pick label="操作" value={data.filters.operation} options={data.operations.map(o => ({ value: o.key, label: o.label }))} onChange={v => update("operation", v)} /></div>} />
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">操作</th><th>发起</th><th>成功</th><th>拒绝</th><th>未知</th><th>未回报</th><th>成功 P50</th><th className="pr-4">成功 P95</th></tr></thead><tbody>{data.operations.map(o => {
        const series = data.product.operationTrends.find(s => s.operation === o.key);
        return <tr key={o.key} className="border-t border-border"><td className="p-4"><button className="text-left hover:text-primary" onClick={() => update("operation", o.key)}>{o.label} ↗</button></td><td>{o.start}</td><td>{o.success}</td><td>{o.rejected}</td><td>{o.unknown}</td><td>{o.pending}</td><td>{duration(series?.successTiming.p50)}</td><td className="pr-4">{series && series.successTiming.n >= 20 ? duration(series.successTiming.p95) : "—"}</td></tr>;
      })}</tbody></table></div>{!data.operations.length && <Empty />}
      {data.product.quality.operationSeriesTruncated && <p className="p-4 text-xs text-muted-foreground">当前展示最活跃操作的耗时；选择具体操作查看其完整趋势。</p>}
    </Panel>
    {operation && <>
      <div className="flex items-center justify-between text-sm"><span>{operation.label}</span><SmallSample n={operation.successTiming.n} /></div>
      <div className="grid gap-4 xl:grid-cols-2"><Series title="成功响应耗时" label="P50" secondaryLabel="P95" format={duration} points={operation.points.map(p => ({ at: p.at, value: p.successTiming.p50, secondary: p.successTiming.n >= 20 ? p.successTiming.p95 : null, n: p.successTiming.n }))} />
        <Series title="操作结果趋势" label="成功" secondaryLabel="拒绝" points={operation.points.map(p => ({ at: p.at, value: p.success, secondary: p.rejected, n: p.start }))} />
      </div>
      <Panel contentClassName="grid grid-cols-2 md:grid-cols-4 p-0"><Stat label="成功响应 P50" value={duration(operation.successTiming.p50)} note={`${operation.successTiming.n} 样本`} /><Stat label="其它结果响应 P50" value={duration(operation.otherTiming.p50)} note={`${operation.otherTiming.n} 样本`} /><Stat label="结果未知" value={operation.unknown} /><Stat label="未收到结果" value={operation.pending} /></Panel>
    </>}
    {!task?.attempts && <Panel contentClassName="p-4"><p className="text-sm">完整任务需要起止和步骤关联。</p><p className="mt-2 text-xs text-muted-foreground">识别、保存等不同调用的数量各自统计；已有历史可用于响应分析，任务完成趋势从关联采集开始积累。</p></Panel>}
  </div>;
}
export const taskOptions = Object.entries(TASKS).map(([value, t]) => ({ value, label: t.label }));
export function taskLabel(key: string) { return TASKS[key as TaskName]?.label ?? "其他任务"; }
