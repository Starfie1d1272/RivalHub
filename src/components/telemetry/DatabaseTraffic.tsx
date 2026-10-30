import Link from "next/link";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { Bars, Heading, MetricCard, Empty } from "@/components/telemetry/analysis/Elements";
import { getDbTraffic } from "@/lib/telemetry/dashboard";

const displayTime = (at: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
const count = (n: number) => n.toLocaleString("zh-CN");
const supplied = (n: number, complete: boolean) => complete ? count(n) : n ? `部分提供 ${count(n)}` : "未提供";

type Selection = { hour?: string; release?: string; deployment?: string };
export async function DatabaseTraffic({ hours, sort, selection }: { hours: 24 | 72; sort: "queries" | "time" | "rows" | "bytes"; selection: Selection }) {
  const result = await getDbTraffic(hours, selection);
  if (result.status !== "ready") return <PageLayout variant="workbench" className="space-y-6"><PageHeader title="数据库流量来源" /><Link href="/admin/telemetry">返回产品遥测</Link><Panel>{result.status === "unconfigured" ? "尚未配置遥测查询。" : "遥测读取失败，请稍后重试。"}</Panel></PageLayout>;
  const data = result.data;
  const windows = data.windows ?? [];
  const selected = windows.find(row => String(row.hour) === selection.hour && row.release === selection.release && row.deployment === selection.deployment) ?? windows[0];
  const field = sort === "time" ? "queryMs" : sort === "rows" ? "rows" : sort === "queries" ? "queries" : "rxBytes";
  const href = (hour: number, release: string, deployment: string, order = sort) => ({ pathname: "/admin/telemetry" as const, query: { view: "database", hours: String(hours), sort: order, hour: String(hour), release, deployment } });
  const sources = selected ? [...selected.sources].sort((a, b) => b[field] - a[field]) : [];
  const shapes = selected ? [...selected.shapes].sort((a, b) => b[field] - a[field]).slice(0, 20) : [];
  const attributed = sources.reduce((sum, row) => sum + row.rxBytes, 0);
  const complete = !!selected && selected.rxComplete && selected.scopedComplete;
  const difference = selected && complete && selected.observedConnections > 0 ? selected.receivedBytes - attributed - selected.remainingRxBytes : null;
  return <PageLayout variant="workbench" className="space-y-6">
    <PageHeader title="数据库流量来源" description={`${displayTime(data.start)} 至 ${displayTime(data.generatedAt)}（北京时间，按小时起点对齐）`} />
    <div className="flex gap-4 text-sm"><Link href="/admin/telemetry">返回产品遥测</Link><Link href="/admin/telemetry?view=database&hours=24">24 小时</Link><Link href="/admin/telemetry?view=database&hours=72">72 小时</Link></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard label="全部已观测协议字节" value={count(data.receivedBytes)} note="包含所选范围内所有版本和进程；未观测连接的字节未知，不是供应商账单。" />
      <MetricCard label="已报告丢失窗口" value={count(data.dropped)} note={`已知丢失字节 ${data.droppedReceivedBytes === undefined ? "未提供" : supplied(data.droppedReceivedBytes, !!data.lossComplete)}；未确认批次 ${data.unconfirmedBatches === undefined ? "未提供" : supplied(data.unconfirmedBatches, !!data.lossComplete)}，字节 ${data.unconfirmedReceivedBytes === undefined ? "未提供" : supplied(data.unconfirmedReceivedBytes, !!data.lossComplete)}。进程退出及尚未送达的尾窗不在此数中。`} />
      <MetricCard label="待汇总批次" value={data.pending >= 513 ? "≥513" : count(data.pending)} note="待汇总批次未计入排行。" />
    </div>
    {!!data.unscopedHours?.length && <Panel>历史汇总有 {count(data.unscopedHours.length)} 个小时无法拆分到版本；这些数据不进入同窗来源排行。</Panel>}
    <Panel contentClassName="p-0"><Heading title="选择小时与版本" note="来源和形态排行仅使用选中的小时、release 和 deployment。" />
      {!windows.length ? <Empty>{data.windows === undefined ? "当前 Worker 未提供按版本拆分的来源排行。" : data.unscopedHours?.length ? "历史数据未提供版本分窗。" : data.pending ? "暂无已汇总分窗数据，仍有批次待汇总。" : "暂无已接收分窗数据；采集和投递状态未知。"}</Empty> : <div className="max-h-64 overflow-auto divide-y divide-border">{windows.map(row => <Link className="block p-3 text-sm" key={`${row.hour}:${row.release}:${row.deployment}`} href={href(row.hour, row.release, row.deployment)} aria-current={selected === row ? "page" : undefined}>{displayTime(row.hour)} · {row.release} / {row.deployment} · {count(row.receivedBytes)} 已观测字节{!row.scopedComplete ? " · 历史数据未拆分" : ""}</Link>)}</div>}
    </Panel>
    {selected && <>
      <Panel><p className="font-medium">{displayTime(selected.hour)} · {selected.release} / {selected.deployment}</p><p className="mt-2 text-sm">已观测接收 {count(selected.receivedBytes)} · 来源 {supplied(attributed, complete)} · 未归属 {supplied(selected.remainingRxBytes, complete)} · 已观测差额 {difference === null ? "未提供" : count(difference)} 字节</p><p className="mt-2 text-sm text-muted-foreground">连接采样时可观测 {count(selected.observedConnections)} / 总数 {count(selected.connections)}；未观测连接的字节未知，不能推断字节覆盖率。</p><p className="mt-2 text-sm text-muted-foreground">异步 {supplied(selected.remaining.async, complete)} · 无查询 {supplied(selected.remaining.no_owner, complete)} · 未完成帧 {supplied(selected.remaining.partial, complete)} · 不支持 {supplied(selected.remaining.unsupported, complete)} · 计量异常 {supplied(selected.remaining.instrumentation, complete)}</p><p className="mt-2 text-sm text-muted-foreground">{selected.batches} 批 · {selected.processes} 进程 · 已报告丢失 {selected.dropped} 窗口 / {selected.droppedReceivedBytes === undefined ? "未提供" : supplied(selected.droppedReceivedBytes, !!selected.lossComplete)} 字节 · 未确认 {selected.unconfirmedBatches === undefined ? "未提供" : supplied(selected.unconfirmedBatches, !!selected.lossComplete)} 批 / {selected.unconfirmedReceivedBytes === undefined ? "未提供" : supplied(selected.unconfirmedReceivedBytes, !!selected.lossComplete)} 字节{selected.truncated ? " · 形态或版本已截断" : ""}{!selected.scopedComplete ? " · 此小时有旧数据无法拆分到版本" : ""}</p></Panel>
      <Panel contentClassName="p-0"><Heading title="来源排行" note="按当前窗口排序；协议字节按接收时间计入，查询次数按完成时间计入。" /><div className="flex flex-wrap gap-4 p-4 text-sm">{([ ["bytes", "协议字节"], ["queries", "次数"], ["time", "耗时"], ["rows", "行数"] ] as const).map(([key, label]) => <Link key={key} href={href(selected.hour, selected.release, selected.deployment, key)}>按{label}</Link>)}</div><div className="p-4"><Bars rows={sources.map(row => ({ key: row.source, label: row.source, value: row[field], displayValue: `${supplied(row.rxBytes, row.rxComplete && selected.scopedComplete)} 协议字节 · ${count(row.queries)} 次 · ${supplied(row.logicalRowJsonBytes, row.logicalComplete)} 逻辑字节 · 已测 ${supplied(row.logicalMeasuredQueries, row.logicalComplete)} · 未测原因 ${row.skipReasonsComplete ? `预算 ${count(row.skipReasons.budget)} / 值不支持 ${count(row.skipReasons.unsupported_value)} / 错误 ${count(row.skipReasons.error)}` : "未提供或部分提供"}` }))} unit="" /></div></Panel>
      <Panel contentClassName="p-0"><Heading title="查询形态排行" note={selected.truncated ? "形态截断；所示为保留片段。" : "当前窗口前 20 项。"} /><div className="divide-y divide-border">{shapes.map(row => <div className="flex flex-wrap justify-between gap-2 p-4 text-sm" key={`${row.source}:${row.template}`}><span>{row.source} · {row.template}</span><span>{supplied(row.rxBytes, row.rxComplete && selected.scopedComplete)} 协议字节 · {count(row.queries)} 次 · {supplied(row.logicalRowJsonBytes, row.logicalComplete)} 逻辑字节 · {count(row.rows)} rowCount</span></div>)}</div></Panel>
    </>}
    <Panel contentClassName="p-0"><Heading title="离线消费者" note="制品字节和逻辑字节不是数据库网络字节。" />{!data.offline.length ? <Empty>窗口内暂无已接收的离线摘要。</Empty> : <div className="divide-y divide-border">{data.offline.map(row => <div key={`${row.consumer}:${row.run}`} className="space-y-1 p-4 text-sm"><p>{row.consumer} · {row.run} · {row.release} · {row.status}</p><p className="text-muted-foreground">{displayTime(row.started)} – {displayTime(row.ended)} · 行 {row.rows == null ? "未知" : count(row.rows)} · 逻辑字节 {row.logicalBytes == null ? "未知" : count(row.logicalBytes)} · dump {row.dumpBytes == null ? "未知" : count(row.dumpBytes)} · snapshot {row.snapshotBytes == null ? "未知" : count(row.snapshotBytes)} · artifact {row.artifactBytes == null ? "未知" : count(row.artifactBytes)} · Storage {row.storageBytes == null ? "未知" : count(row.storageBytes)}</p></div>)}</div>}{data.offlineTruncated && <p className="p-4">离线摘要已截断。</p>}</Panel>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">统计口径与覆盖缺口</summary><p className="mt-3">协议字节是已接入连接建连后的 PostgreSQL 下行；TLS 连接计量解密后的内容，不含握手及 TLS 开销，也不覆盖其他消费者。供应商账单范围更广。旧批次缺失的字段显示未提供，未送达的窗口及进程强制退出损失无法由已送达数据推断。rowCount 包含写入影响行数。指纹仅供在对应 release 的隔离环境比对，不输出 SQL 或参数。</p></details>
  </PageLayout>;
}
