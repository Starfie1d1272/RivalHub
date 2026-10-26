"use client";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { Empty, Heading, Series, Stat, date, duration, number } from "./Elements";
export function ProblemsAnalysis({ data, session, selectSession }: { data: Analysis; session: string; selectSession: (value: string) => void }) {
  return <div className="space-y-4"><Panel contentClassName="grid grid-cols-2 md:grid-cols-4 p-0"><Stat label="客户端异常报告" value={data.totals.errors} /><Stat label="结果未知报告" value={data.totals.unknownReports} /><Stat label="业务拒绝报告" value={data.totals.rejectedReports} /><Stat label="异常影响会话" value={data.totals.affectedSessions} note={`当前范围 ${data.totals.sessions} 个会话`} /></Panel>
    <Series title="异常出现趋势" label="异常与结果未知报告" points={data.buckets.map(b => ({ at: b.at, value: b.errors, n: b.sessions }))} />
    {[['client', '客户端异常'], ['unknown', '技术结果未知'], ['rejected', '业务与认证拒绝']].map(([kind, title]) => <Panel key={kind} contentClassName="p-0"><Heading title={title} note={kind === "rejected" ? "包含资格、权限与输入条件阻碍；按原因判断后续改进。" : "按页面、操作和错误分类聚合；指纹用于关联线索。"} />
      {data.errorGroups.filter(g => g.type === kind).sort((a, b) => b.sessions - a.sessions || b.n - a.n).map(g => <details key={g.key} className="border-t border-border p-4 text-sm"><summary className="cursor-pointer"><span>{g.label} · {g.operationLabel} · {g.reason}</span><span className="ml-3 text-muted-foreground">{g.n} 次 / {g.sessions} 会话 · 最近 {date(g.last)}</span></summary><div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <p>错误分类 {g.code || "未提供"} · 指纹 {g.fingerprint || "未提供"} · {g.category || "未分类"}</p>
        {g.details.map((d, i) => <div key={i} className="flex flex-wrap items-center gap-3"><span>{date(d.at)}</span><Button size="sm" variant="ghost" onClick={() => selectSession(d.session)}>{d.sessionLabel} ↗</Button><span>{d.role}</span><span>版本 {d.release === "missing" ? "未采集" : d.release.slice(0, 7)}</span>{d.requestId && <code>requestId: {d.requestId}</code>}</div>)}</div></details>)}
      {!data.errorGroups.some(g => g.type === kind) && <Empty>当前范围未观测到此类报告。</Empty>}
    </Panel>)}
    <Panel contentClassName="p-0"><Heading title="短期会话证据" note="最近 100 个会话；选中后最多显示 100 条事件。会话标识仅用于本次排查。" action={session && <Button size="sm" variant="ghost" onClick={() => selectSession("")}>关闭会话</Button>} />
      {session ? <div className="divide-y divide-border">{data.timeline.map((e, i) => <div key={i} className="flex flex-wrap gap-3 p-4 text-sm"><time className="text-muted-foreground">{date(e.at)}</time><span>{e.label}</span><span>{e.phase} {e.detail}</span>{e.duration != null && <span>{duration(e.duration)}</span>}{e.requestId && <code className="text-xs">requestId: {e.requestId}</code>}</div>)}{!data.timeline.length && <Empty>该会话在当前筛选范围暂无记录。</Empty>}</div> : <div className="grid divide-y divide-border sm:grid-cols-2">{data.sessions.map(s => <button key={s.key} className="p-4 text-left text-sm hover:bg-secondary" onClick={() => selectSession(s.key)}><span>{s.label} · {s.role} ↗</span><p className="mt-1 text-xs text-muted-foreground">{date(s.first)} – {date(s.last)} · {s.pages} 访问 / {s.actions} 操作 / {s.errors} 异常</p></button>)}</div>}
    </Panel>
  </div>;
}
export function QualityAnalysis({ data }: { data: Analysis }) {
  const c = data.product.coverage, q = data.product.quality;
  const coverage = (a: number, b: number) => b ? `${number(a / b * 100)}% · ${a} / ${b}` : "暂无分母";
  return <div className="space-y-4"><Panel contentClassName="p-0"><Heading title="采集覆盖" note="覆盖随条件变化；缺失字段保持未知。" /><div className="grid grid-cols-2 md:grid-cols-3"><Stat label="增强字段覆盖" value={coverage(c.enhanced, c.reports)} /><Stat label="增强页面覆盖" value={coverage(c.enhancedPages, c.pages)} /><Stat label="设备分类覆盖" value={coverage(c.clientClassifiedPages, c.pages)} /><Stat label="内容就绪样本" value={c.ready} /><Stat label="任务报告" value={c.task} /><Stat label="未采集客户端版本" value={c.clientVersionMissing} /></div></Panel>
    <Panel contentClassName="p-0"><Heading title="数据范围与新鲜度" /><dl className="grid gap-4 p-4 text-sm sm:grid-cols-2">{[
      ["本次读取", date(data.meta.capturedAt, true)], ["最新收到报告", data.meta.latest ? date(data.meta.latest, true) : "暂无"], ["本次最早观测", data.meta.oldest ? date(data.meta.oldest, true) : "暂无"], ["首次观测增强报告", c.firstEnhancedAt ? date(c.firstEnhancedAt, true) : "暂无"], ["读取批次 / 原始报告", `${data.meta.batches} / ${data.meta.totalReports}`], ["读取字节", `${number(data.meta.bytes / 1024)} KiB`], ["保留边界裁剪", data.product.window.retentionClipped ? "已裁剪至当前可读的七天" : "无"], ["查询预算截断", data.meta.truncated ? "已截断，统计不完整" : "未触及预算"],
    ].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-1">{v}</dd></div>)}</dl></Panel>
    <Panel contentClassName="p-0"><Heading title="关联质量" note="操作开始和结果、任务开始和步骤均要求同一短期身份内关联。" /><div className="grid grid-cols-2 md:grid-cols-3"><Stat label="操作结果覆盖" value={`${number(data.totals.outcomeCoveragePct)}%`} note={`${data.totals.starts - data.totals.pending} / ${data.totals.starts} 次开始`} /><Stat label="单独观测到操作结果" value={data.totals.resultOnly} /><Stat label="缺少样本标识的性能报告" value={data.totals.legacyPerformance} /><Stat label="缺少开始的任务报告" value={q.orphanTaskReports} /><Stat label="超观察窗口完成" value={q.lateTaskCompletions} /><Stat label="缺少导航关联的就绪报告" value={q.readyWithoutNavigation} /></div></Panel>
    {q.releaseDirectoryTruncated && <p className="text-sm text-muted-foreground">版本目录达到读取预算，部分较早版本可能未列出。</p>}
    <Panel contentClassName="p-0"><Heading title="导航生命周期" /><div className="flex flex-wrap gap-6 p-4">{data.product.lifecycle.map(l => <div key={l.key} className="text-sm"><p className="text-xs text-muted-foreground">{l.label}</p><p className="mt-2">{l.reports} 报告</p></div>)}</div></Panel>
    <Panel contentClassName="p-0"><Heading title="接收用量与清理" note="全站 UTC 日口径，不随上方条件变化；批次用量不等于云服务账单。" /><div className="p-4 text-sm"><p>每日接收预算：{number(data.usage.budget.batches)} 批 / {number(data.usage.budget.bytes / 1048576)} MiB · 待清理 {number(data.usage.expiredBatches)} 批</p><div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">{data.usage.usage.map(d => <span key={d.day}>{d.day} · {number(d.batches)} 批 / {number(d.bytes / 1048576)} MiB</span>)}</div></div></Panel>
    <p className="text-xs leading-6 text-muted-foreground">DNT/GPC、离线、浏览器限制与队列上限都可能造成缺数。会话数与账号数各自去重；本次最早观测仅说明读取到的报告。长期聚合从实际启用时开始积累。</p>
  </div>;
}
