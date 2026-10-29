import Link from "next/link";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { getDbTraffic } from "@/lib/telemetry/dashboard";

export async function DatabaseTraffic({ hours }: { hours: 24 | 72 }) {
  const result = await getDbTraffic(hours);
  return <PageLayout variant="workbench" className="space-y-6">
    <PageHeader title="数据库流量来源" description={`最近 ${hours} 小时的进程查询聚合`} />
    <div className="flex gap-4"><Link href="/admin/telemetry">返回产品遥测</Link><Link href="/admin/telemetry?view=database&hours=24">24 小时</Link><Link href="/admin/telemetry?view=database&hours=72">72 小时</Link></div>
    <Panel><p>数据库接收网络字节与供应商实际用量尚未接入；返回行数不是网络字节或账单。统计覆盖已接入的进程和普通查询；unknown 与 unsupported 表示覆盖缺口，进程重启或投递失败可能造成窗口缺失。</p></Panel>
    {result.status !== "ready" ? <Panel>数据库遥测尚未配置或暂不可用。</Panel> : <>
      <Panel><h2>来源与查询类别排行</h2><p>已报告的队列满丢失窗口：{result.data.dropped}；重启与尚未送达的丢失不在此数中。</p><p>类别是固定 SQL 操作类型，并非逐条 SQL 模板。</p><div className="overflow-x-auto"><table><thead><tr><th>来源</th><th>类别</th><th>查询</th><th>失败</th><th>rowCount（含影响行）</th><th>总耗时 ms</th></tr></thead><tbody>{result.data.totals.map(row => <tr key={`${row.source}:${row.template}`}><td>{row.source}</td><td>{row.template}</td><td>{row.queries}</td><td>{row.failures}</td><td>{row.rows}</td><td>{Math.round(row.queryMs)}</td></tr>)}</tbody></table></div></Panel>
      <Panel><h2>每小时趋势与版本</h2>{result.data.truncated && <p>版本分组已截断，趋势不完整。</p>}<div className="overflow-x-auto"><table><thead><tr><th>UTC</th><th>版本 / 部署</th><th>进程</th><th>批次</th><th>查询</th><th>rowCount（含影响行）</th></tr></thead><tbody>{result.data.hours.map(row => <tr key={`${row.hour}:${row.release}:${row.deployment}`}><td>{new Date(row.hour).toISOString()}</td><td>{row.release} / {row.deployment}</td><td>{row.processes}</td><td>{row.batches}</td><td>{row.queries}</td><td>{row.rows}</td></tr>)}</tbody></table></div></Panel>
    </>}
  </PageLayout>;
}
