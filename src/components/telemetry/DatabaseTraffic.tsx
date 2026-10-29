import Link from "next/link";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { Bars, Heading, MetricCard, Empty } from "@/components/telemetry/analysis/Elements";
import { getDbTraffic } from "@/lib/telemetry/dashboard";

const displayTime = (at: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
const count = (n: number) => n.toLocaleString("zh-CN");
const pct = (n: number, total: number) => total ? `${(100 * n / total).toFixed(1)}%` : "—";
export async function DatabaseTraffic({ hours, sort }: { hours: 24 | 72; sort: "queries" | "time" | "rows" }) {
  const result = await getDbTraffic(hours);
  if (result.status !== "ready") return <PageLayout variant="workbench" className="space-y-6"><PageHeader title="数据库流量来源" /><Link href="/admin/telemetry">返回产品遥测</Link><Panel>{result.status === "unconfigured" ? "尚未配置遥测查询。" : "遥测读取失败，请稍后重试。"}</Panel></PageLayout>;
  const data = result.data;
  const total = data.sources.reduce((sum, row) => sum + row.queries, 0);
  const unsupported = data.sources.reduce((sum, row) => sum + row.unsupported, 0);
  const overflow = data.sources.reduce((sum, row) => sum + row.overflow, 0);
  const field = sort === "time" ? "queryMs" : sort === "rows" ? "rows" : "queries";
  const sourceRanking = [...data.sources].sort((a, b) => b[field] - a[field]);
  const metricTotal = data.sources.reduce((sum, row) => sum + row[field], 0);
  const ranking = sort === "time" ? data.byTime : sort === "rows" ? data.byRows : data.totals;
  const unknown = data.sources.find(row => row.source === "unknown")?.queries ?? 0;
  return <PageLayout variant="workbench" className="space-y-6">
    <PageHeader title="数据库流量来源" description={`${displayTime(data.start)} 至 ${displayTime(data.generatedAt)}（北京时间，按小时起点对齐）`} />
    <div className="flex gap-4 text-sm"><Link href="/admin/telemetry">返回产品遥测</Link><Link href="/admin/telemetry?view=database&hours=24">24 小时</Link><Link href="/admin/telemetry?view=database&hours=72">72 小时</Link></div>
    {!total && !data.receivedBytes && !data.offline.length && !data.pending ? <Panel><Empty>此窗口暂无已接收数据；不代表数据库没有流量。</Empty></Panel> : <>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="已观测查询" value={count(total)} note={`未知来源 ${count(unknown)} · ${pct(unknown, total)}；待汇总 ${data.pending >= 513 ? "≥513" : count(data.pending)} 批`} />
        <MetricCard label="连接读入协议字节" value={count(data.receivedBytes)} note={`连接采样点覆盖 ${pct(data.observedConnections, data.connections)}；所有字节未分摊到查询`} />
        <MetricCard label="已报告丢失窗口" value={count(data.dropped)} note="重启与尚未送达的丢失不在此数中" />
      </div>
      <Panel contentClassName="p-0"><Heading title="来源排行" note="占比以所选指标的已汇总值为分母；不代表字节占比。" /><div className="p-4"><Bars rows={sourceRanking.map(row => ({ key: row.source, label: row.source, value: row[field], displayValue: `${pct(row[field], metricTotal)} · ${count(row.queries)} 次 · ${count(row.rows)} 行 · ${count(Math.round(row.queryMs))} ms` }))} unit="" /></div></Panel>
      <Panel contentClassName="p-0"><Heading title="查询形态排行" note={data.truncated ? "形态已截断：数值是保留片段的下界，不能保证全窗口前 20。" : "按已汇总形态排序后展示前 20 项。"} /><div className="flex gap-4 p-4 text-sm"><Link href={`/admin/telemetry?view=database&hours=${hours}&sort=queries`}>按次数</Link><Link href={`/admin/telemetry?view=database&hours=${hours}&sort=time`}>按耗时</Link><Link href={`/admin/telemetry?view=database&hours=${hours}&sort=rows`}>按行数</Link></div><div className="divide-y divide-border">{ranking.map(row => <div className="flex flex-wrap justify-between gap-2 p-4 text-sm" key={`${row.source}:${row.template}`}><span>{row.source} · {row.template}</span><span className="tabular-nums">{count(row.queries)} 次 · {count(row.failures)} 失败 · {count(row.rows)} rowCount · {count(Math.round(row.queryMs))} ms</span></div>)}</div></Panel>
      <Panel contentClassName="p-0"><Heading title="小时趋势与版本" note="查询按完成时间计入；版本分组可能跨进程重启。" />{data.truncated && <p className="p-4">小时形态或版本分组已截断，排行和趋势不完整。</p>}<div className="divide-y divide-border">{data.hours.map(row => <div className="flex flex-wrap justify-between gap-2 p-4 text-sm" key={`${row.hour}:${row.release}:${row.deployment}`}><span>{displayTime(row.hour)} · {row.release} / {row.deployment}</span><span>{count(row.queries)} 次 · {count(row.receivedBytes)} 协议字节 · {count(row.rows)} rowCount · {count(row.processes)} 进程 · {count(row.batches)} 批</span></div>)}</div></Panel>
      <Panel contentClassName="p-0"><Heading title="离线消费者" note="沿用备份和 Preview 已有摘要；制品字节和逻辑字节不是数据库网络字节。" />{!data.offline.length ? <Empty>窗口内暂无已接收的离线摘要。</Empty> : <div className="divide-y divide-border">{data.offline.map(row => <div key={`${row.consumer}:${row.run}`} className="space-y-1 p-4 text-sm"><p>{row.consumer} · {row.run} · {row.release} · {row.status}</p><p className="text-muted-foreground">{displayTime(row.started)} – {displayTime(row.ended)} · 行 {row.rows == null ? "未知" : count(row.rows)} · 逻辑字节 {row.logicalBytes == null ? "未知" : count(row.logicalBytes)} · dump {row.dumpBytes == null ? "未知" : count(row.dumpBytes)} · snapshot {row.snapshotBytes == null ? "未知" : count(row.snapshotBytes)} · artifact {row.artifactBytes == null ? "未知" : count(row.artifactBytes)} · Storage {row.storageBytes == null ? "未知" : count(row.storageBytes)}</p></div>)}</div>}{data.offlineTruncated && <p className="p-4">离线摘要已截断。</p>}</Panel>
    </>}
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">统计口径与覆盖缺口</summary><p className="mt-3">连接读入量包含已接入连接的 PostgreSQL 协议帧，不含启动握手和 TLS 传输开销，不能归属于单条查询，也不是供应商账单。连接覆盖比例是采样时的连接数比例，不是字节覆盖比例。供应商实际用量尚未接入；unsupported、unknown、进程重启和投递失败均会留下缺口。rowCount 包含写入影响行数。不支持 {count(unsupported)} 次，原窗口溢出 {count(overflow)} 次；{data.truncated ? "形态截断后所示数值是保留片段的下界，不能保证全窗口前 20。" : ""}小时任务每次最多处理 128 批，正常接收也会尽力推进，待汇总数据未计入排行。指纹仅在当前版本对应源码，不是 pg_stat_statements queryid；在隔离环境对候选查询调用 queryShape 计算后比对，不输出 SQL 或参数。</p></details>
  </PageLayout>;
}
