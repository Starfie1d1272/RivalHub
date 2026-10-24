import { eq } from "drizzle-orm";
import { db, getDatabasePoolSnapshot } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getDisplayName } from "@/lib/identity/display-name";
import { PageHeader, PageLayout, Panel, StatusPill } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { SchedulerHealthPanel } from "@/components/admin/SchedulerHealthPanel";
import { getSchedulerHealthView } from "@/lib/scheduler/admin";
import { getRuntimeHealthSnapshot } from "@/lib/observability/server";

const ENV_VARS = [
  {
    key: "STEAM_API_KEY",
    label: "Steam Web API Key",
    description: "用于抓取选手 Steam 官方资料。申请地址：steamcommunity.com/dev/apikey",
    required: false,
  },
  {
    key: "CRON_SECRET",
    label: "定时任务服务凭据",
    description: "用于生产环境业务定时任务；只展示是否配置，不展示凭据值。",
    required: false,
  },
  {
    key: "SILICONFLOW_API_KEY",
    label: "SiliconFlow OCR API Key",
    description: "用于玩家数据截图 OCR 识别。已配置只表示存在，凭据有效性与账号权限尚未核验。",
    required: false,
  },
] as const;

function RuntimeHealthPanel() {
  const runtime = getRuntimeHealthSnapshot();
  const pool = getDatabasePoolSnapshot();
  const memoryLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  const runtimeRows = runtime ? [
    ["Node.js", runtime.nodeVersion],
    ["连续运行", `${Math.floor(runtime.uptimeSeconds / 60).toLocaleString("zh-CN")} 分钟`],
    ["进程驻留内存", memoryLabel(runtime.rssBytes)],
    ["堆已用 / 当前容量", `${memoryLabel(runtime.heapUsedBytes)} / ${memoryLabel(runtime.heapTotalBytes)}`],
    ["V8 堆上限", memoryLabel(runtime.heapLimitBytes)],
    ["环境内存约束", runtime.constrainedMemoryBytes === null ? "未提供" : memoryLabel(runtime.constrainedMemoryBytes)],
    ["事件循环忙碌比例（自启动）", `${(runtime.eventLoopUtilization * 100).toFixed(1)}%`],
  ] : [];

  return (
    <section aria-labelledby="runtime-health-title" className="space-y-4">
      <div className="space-y-1">
        <h2 id="runtime-health-title" className="text-base font-semibold text-[var(--color-fg)]">服务进程</h2>
        <p className="text-xs text-[var(--color-fg-mid)]">打开或刷新本页时读取当前进程；事件循环比例为自启动累计值。</p>
      </div>
      <Panel contentClassName="space-y-4 p-4">
        {runtime ? <>
          <p className="text-xs text-[var(--color-fg-mid)]">采样时间：{new Date(runtime.sampledAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
          <dl className="grid gap-4 sm:grid-cols-2">
            {runtimeRows.map(([label, value]) => <div key={label} className="space-y-1">
              <dt className="text-xs text-[var(--color-fg-mid)]">{label}</dt>
              <dd className="text-sm font-mono text-[var(--color-fg)]">{value}</dd>
            </div>)}
          </dl>
        </> : <p className="text-sm text-[var(--color-fg-mid)]">暂时无法读取进程状态。</p>}
        <div className="border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-fg-mid)]">
          {pool ? <p>数据库连接 {pool.total} / {pool.max ?? "—"}；闲置 {pool.idle}；等待连接 {pool.waiting}。</p> : <p>当前进程尚未创建数据库连接池。</p>}
        </div>
      </Panel>
    </section>
  );
}

export default async function AdminSettingsPage() {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const [[adminUser], schedulerHealth] = await Promise.all([
    db.select({
      personaName: steamProfiles.personaName,
      displayName: users.displayName,
      perfectName: users.perfectName,
    })
      .from(users)
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(users.id, admin.userId))
      .limit(1),
    getSchedulerHealthView(),
  ]);
  const adminDisplayName = adminUser ? getDisplayName(adminUser) : admin.email;

  return (
    <PageLayout variant="narrow" className="space-y-10">
        <PageHeader title="系统状态" description={`当前登录：${adminDisplayName}`} />

        <RuntimeHealthPanel />

        {/* 密码管理 */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-fg)]">密码管理</h2>
          <Panel contentClassName="p-4 text-sm text-[var(--color-fg-mid)]">
            管理员账号统一使用 Supabase Auth。请前往个人设置修改密码，权限变更会在下一次请求中从当前数据库事实读取。
          </Panel>
        </section>

        {/* 环境变量状态 */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[var(--color-fg)]">环境变量状态</h2>
            <p className="text-xs text-[var(--color-fg-mid)]">
              配置由部署环境的负责人维护，本页只展示是否配置。
            </p>
          </div>
          <Panel contentClassName="p-0 divide-y divide-[var(--color-border)]" className="overflow-hidden">
            {ENV_VARS.map(({ key, label, description, required }) => {
              const isSet = !!process.env[key];
              return (
                <div key={key} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-[var(--color-fg)]">{key}</code>
                      {required && (
                        <StatusPill label="必填" tone="warn" />
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-fg-mid)]">{label}</p>
                    <p className="text-xs text-[var(--color-fg-mid)] opacity-70">{description}</p>
                  </div>
                  <StatusPill label={isSet ? "已配置" : "未配置"} tone={isSet ? "success" : "neutral"} />
                </div>
              );
            })}
          </Panel>
        </section>

        <section id="ocr-configuration" className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-fg)]">OCR 配置检查</h2>
          <Panel contentClassName="space-y-3 p-4 text-sm text-[var(--color-fg-mid)]">
            <p>遇到鉴权失败，请由配置负责人在当前部署的受保护环境配置中检查 SILICONFLOW_API_KEY 是否对应发生错误的环境与版本；本页不验证密钥有效性。</p>
            <p>同时检查 SILICONFLOW_API_URL 的服务地址与 SILICONFLOW_MODEL 的模型配置，并在 SiliconFlow 控制台核对凭据是否有效、账号权限、模型访问权限及余额。不要在截图、日志或工单中提交密钥。</p>
            <p>使用 OCR 提示中的排查编号查询 Runtime Logs，结合 HTTP 状态、失败阶段和脱敏原因定位问题。配置存在不能证明上游鉴权成功。</p>
          </Panel>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[var(--color-fg)]">定时任务健康</h2>
            <p className="text-xs text-[var(--color-fg-mid)]">展示当前健康投影；“立即运行一次”仅用于故障恢复，会检查并可能推进对应业务状态。</p>
          </div>
          <SchedulerHealthPanel jobs={schedulerHealth} />
        </section>
    </PageLayout>
  );
}
