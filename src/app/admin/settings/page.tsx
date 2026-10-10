import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getDisplayName } from "@/lib/identity/display-name";
import { PageHeader, PageLayout, Panel, StatusPill } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { SchedulerHealthPanel } from "@/components/admin/SchedulerHealthPanel";
import { getSchedulerHealthView } from "@/lib/scheduler/admin";

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

export default async function AdminSettingsPage() {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const [adminUser] = await db
    .select({
      personaName: steamProfiles.personaName,
      displayName: users.displayName,
      perfectName: users.perfectName,
    })
    .from(users)
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(eq(users.id, admin.userId))
    .limit(1);
  const adminDisplayName = adminUser ? getDisplayName(adminUser) : admin.email;
  const schedulerHealth = await getSchedulerHealthView();

  return (
    <PageLayout variant="narrow" className="space-y-10">
        <PageHeader title="系统状态" description={`当前登录：${adminDisplayName}`} />

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
              这些配置需在服务器环境变量中设置（.env.local 或 Vercel Dashboard），不能通过界面修改。
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
            <p>遇到鉴权失败，请由配置负责人在 Vercel 项目的 Settings → Environment Variables 检查 SILICONFLOW_API_KEY 是否绑定到发生错误的环境及当前部署；本页不验证密钥有效性。</p>
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
