import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getTelemetryDashboard } from "@/lib/telemetry/dashboard";
import type { DashboardData } from "@/lib/telemetry/dashboard-contract";
import { parseDashboardFilters } from "@/lib/telemetry/dashboard-query";
import { ROUTES } from "@/lib/telemetry/routes";

const control = "rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm";
const cell = "px-3 py-2 text-left";
const integer = (value: number) => value.toLocaleString("zh-CN");
const milliseconds = (total: number, count: number) => count ? `${Math.round(total / count).toLocaleString("zh-CN")} ms` : "—";
const categoryLabels: Record<string, string> = {
  mobile: "手机", tablet: "平板", desktop: "电脑", unknown: "未知", other: "其他",
  chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge",
  windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iOS",
  none: "未提供", internal: "站内", search: "搜索", social: "社交", external: "外部来源",
};
const utc = (at: number) => new Date(at).toISOString().replace("T", " ").slice(0, 16);

function Trend({ rows }: { rows: DashboardData["trend"] }) {
  const max = Math.max(1, ...rows.flatMap(row => [row.page, row.start, row.error]));
  const series = [{ key: "page", label: "页面访问", color: "var(--color-accent)" }, { key: "start", label: "操作开始", color: "var(--color-info)" }, { key: "error", label: "客户端错误", color: "var(--color-danger)" }] as const;
  return <Panel contentClassName="space-y-3 p-4">
    <h2 className="font-semibold">每小时趋势</h2>
    <svg viewBox="0 0 800 180" role="img" aria-label="按 UTC 接收小时分组的页面访问、操作开始和客户端错误次数" className="w-full">
      <title>每小时事件次数，纵轴范围 0 至 {max}</title>
      {[0, 1, 2].map(i => <g key={i}><line x1="35" x2="790" y1={15 + i * 65} y2={15 + i * 65} stroke="var(--color-border)" /><text x="0" y={19 + i * 65} fill="currentColor" fontSize="11">{Math.round(max * (1 - i / 2))}</text></g>)}
      {series.map(s => <polyline key={s.key} points={rows.map((row, i) => `${35 + i / Math.max(1, rows.length - 1) * 755},${145 - row[s.key] / max * 130}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" />)}
      <text x="35" y="175" fill="currentColor" fontSize="11">{rows[0] ? utc(rows[0].at) : ""}</text>
      <text x="790" y="175" textAnchor="end" fill="currentColor" fontSize="11">{rows.at(-1) ? utc(rows.at(-1)!.at) : ""} UTC</text>
    </svg>
    <div className="flex flex-wrap gap-4 text-sm">{series.map(s => <span key={s.key} style={{ color: s.color }}>● {s.label}</span>)}</div>
    <details className="text-sm"><summary className="cursor-pointer">查看小时数据</summary><div className="max-h-64 overflow-auto"><table className="w-full"><thead><tr>{["UTC 小时", "访问", "操作开始", "错误"].map(label => <th className={cell} key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.at}><td className={cell}>{utc(row.at)}</td><td className={cell}>{row.page}</td><td className={cell}>{row.start}</td><td className={cell}>{row.error}</td></tr>)}</tbody></table></div></details>
  </Panel>;
}

export default async function TelemetryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const params = await searchParams;
  const parsed = parseDashboardFilters(Object.fromEntries(Object.entries(params).filter(([key]) => ["hours", "release", "route"].includes(key))));
  const filters = parsed ?? parseDashboardFilters({})!;
  const result = await getTelemetryDashboard(filters);
  const data = result.status === "ready" ? result.data : null;
  return <PageLayout variant="workbench" className="space-y-6">
    <PageHeader title="遥测分析" />
    <form className="flex flex-wrap items-end gap-3" action="/admin/telemetry">
      <label className="grid gap-1 text-sm">时间范围<select name="hours" defaultValue={filters.hours} className={control}><option value="6">最近 6 小时</option><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select></label>
      <label className="grid gap-1 text-sm">版本 commit<input name="release" maxLength={80} defaultValue={filters.release} placeholder="全部版本" className={control} /></label>
      <label className="grid min-w-0 gap-1 text-sm">页面<select name="route" defaultValue={filters.route} className={`${control} max-w-full sm:max-w-80`}><option value="">全部页面</option>{[...ROUTES, "/unknown"].map(route => <option key={route} value={route}>{route}</option>)}</select></label>
      <button className={`${control} cursor-pointer`} type="submit">查询 / 刷新</button>
    </form>
    {!parsed && <p role="alert" className="text-sm text-[var(--color-fg-mid)]">已恢复默认筛选。</p>}
    {!data ? <Panel contentClassName="p-6"><p>{result.status === "unconfigured" ? "尚未配置遥测查询" : "暂时无法读取，请稍后重试"}</p></Panel> : <>
      <p className="text-sm text-[var(--color-fg-mid)]">更新于 {utc(data.generatedAt)} UTC · {integer(data.sampledBatches)} 批 · 窗口最近上报：{data.latestReceived ? `${utc(data.latestReceived)} UTC` : "暂无"}</p>
      {data.truncated && <p role="status" className="rounded border border-[var(--color-border)] p-3 text-sm">仅统计最近 1,000 批，当前筛选时段的数据不完整。</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["页面访问", data.totals.page], ["操作开始", data.totals.start], ["业务拒绝", data.totals.rejected], ["结果未知", data.totals.unknown]].map(([label, n]) => <Panel key={label} contentClassName="p-4"><div className="text-sm text-[var(--color-fg-mid)]">{label}</div><div className="mt-2 font-mono text-2xl">{integer(Number(n))}</div></Panel>)}</div>
      {!data.sampledBatches && <p className="text-sm">所选范围暂无数据。</p>}
      <Trend rows={data.trend} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel contentClassName="space-y-3 p-4"><h2 className="font-semibold">页面访问</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["页面", "访问", "客户端错误"].map(s => <th className={cell} key={s}>{s}</th>)}</tr></thead><tbody>{data.routes.map(row => <tr key={row.route}><td className={`${cell} font-mono break-all`}>{row.route}</td><td className={cell}>{integer(row.pages)}</td><td className={cell}>{integer(row.errors)}</td></tr>)}</tbody></table>{!data.routes.length && <p className="p-3 text-sm">暂无页面报告。</p>}</div></Panel>
        <Panel contentClassName="space-y-3 p-4"><h2 className="font-semibold">页面性能</h2>{data.legacyPerformanceReports > 0 && <p className="text-sm text-[var(--color-fg-mid)]">另有 {integer(data.legacyPerformanceReports)} 条旧版性能报告缺少样本标识，暂不计入均值。</p>}<div className="max-h-96 overflow-auto"><table className="w-full text-sm"><thead><tr>{["页面 / 指标", "指标样本数", "最新值均值"].map(s => <th className={cell} key={s}>{s}</th>)}</tr></thead><tbody>{data.performance.map(row => <tr key={`${row.route}:${row.metric}`}><td className={`${cell} break-all`}>{row.route}<span className="ml-2 font-mono text-xs">{row.metric}</span></td><td className={cell}>{integer(row.reports)}</td><td className={cell}>{row.metric === "CLS" ? ((row.score ?? 0) / row.reports).toFixed(3) : milliseconds(row.durationMs, row.reports)}</td></tr>)}</tbody></table>{!data.performance.length && <p className="p-3 text-sm">暂无性能报告。</p>}</div></Panel>
      </div>
      <Panel contentClassName="space-y-3 p-4"><h2 className="font-semibold">访问环境</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{([["device", "设备类别"], ["browser", "浏览器"], ["os", "操作系统"], ["source", "来源类别"]] as const).map(([dimension, label]) => <div key={dimension}><h3 className="text-sm font-semibold">{label}</h3>{!data.clients.some(row => row.dimension === dimension) ? <p className="mt-2 text-sm text-[var(--color-fg-mid)]">尚未采集</p> : <table className="mt-2 w-full text-sm"><thead><tr><th className={cell}>分类</th><th className={cell}>访问</th></tr></thead><tbody>{data.clients.filter(row => row.dimension === dimension).map(row => <tr key={row.value}><td className={cell}>{categoryLabels[row.value] ?? row.value}</td><td className={cell}>{row.pages}</td></tr>)}</tbody></table>}</div>)}</div></Panel>
      <Panel contentClassName="space-y-3 p-4"><h2 className="font-semibold">业务操作</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["操作", "开始", "成功", "拒绝", "结果未知", "终态平均耗时"].map(s => <th className={cell} key={s}>{s}</th>)}</tr></thead><tbody>{data.operations.map(row => <tr key={row.operation}><td className={`${cell} font-mono`}>{row.operation}</td><td className={cell}>{row.start}</td><td className={cell}>{row.success}</td><td className={cell}>{row.rejected}</td><td className={cell}>{row.unknown}</td><td className={cell}>{milliseconds(row.durationMs, row.success + row.rejected + row.unknown)}</td></tr>)}</tbody></table>{!data.operations.length && <p className="p-3 text-sm">暂无业务操作报告。</p>}</div></Panel>
      <Panel contentClassName="space-y-3 p-4"><h2 className="font-semibold">接收用量</h2><p className="text-sm text-[var(--color-fg-mid)]">每日上限 {integer(data.budget.batches)} 批 / {(data.budget.bytes / 1048576).toFixed(0)} MiB。</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["UTC 接收日", "成功批次", "正文 MiB"].map(s => <th className={cell} key={s}>{s}</th>)}</tr></thead><tbody>{data.usage.map(row => <tr key={row.day}><td className={cell}>{row.day}</td><td className={cell}>{integer(row.batches)}</td><td className={cell}>{(row.bytes / 1048576).toFixed(2)}</td></tr>)}</tbody></table></div><p className="text-sm">待清理到期批次：{integer(data.cleanup.expiredBatches)}{data.cleanup.oldestExpiry ? `；最早到期 ${utc(data.cleanup.oldestExpiry)} UTC` : ""}。</p></Panel>
      <details className="text-sm text-[var(--color-fg-mid)]"><summary className="cursor-pointer">指标口径</summary><div className="mt-3 space-y-2"><p>趋势按 UTC 接收小时统计。设备与来源分类按页面访问计数；设备类型为粗略识别，“未提供”表示未收到来源信息。</p><p>性能对当前批次样本内同一指标 ID 取时间最新值后求均值；CLS 为无单位分数，其余指标为毫秒。访问尚未结束时指标仍会更新，这里不是最终导航 p75。</p><p>操作开始与终态分别计数。结果未知表示未收到明确业务结果，需结合业务记录核查；终态平均耗时按已收到的结果计算。</p><p>接收用量和清理积压为全站数据，不受筛选影响；正文用量为压缩前大小。</p></div></details>
    </>}
  </PageLayout>;
}
