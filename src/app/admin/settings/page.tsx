import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getDisplayName } from "@/lib/identity/display-name";
import { Panel, StatusPill, Marker } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";

const ENV_VARS = [
  {
    key: "STEAM_API_KEY",
    label: "Steam Web API Key",
    description: "用于抓取选手 Steam 头像。申请地址：steamcommunity.com/dev/apikey",
    required: false,
  },
  {
    key: "CRON_SECRET",
    label: "Vercel Cron Secret",
    description: "生产环境选秀超时自动 pick 所需，本地开发可不填。",
    required: false,
  },
  {
    key: "SILICONFLOW_API_KEY",
    label: "SiliconFlow OCR API Key",
    description: "用于玩家数据截图 OCR 识别。在 SiliconFlow 平台申请。",
    required: false,
  },
] as const;

export default async function AdminSettingsPage() {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  const adminUser = await db.query.users.findFirst({
    where: eq(users.id, admin.userId),
    columns: { steamName: true, displayName: true, perfectName: true },
  });
  const adminDisplayName = adminUser ? getDisplayName(adminUser) : admin.email;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-10">
        <div>
          <Marker sub={`当前登录：${adminDisplayName}`}>系统设置</Marker>
        </div>

        {/* 密码管理 */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-fg)]">密码管理</h2>
          <Panel pad={16} className="text-sm text-[var(--color-fg-mid)]">
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
          <Panel pad={0} className="overflow-hidden divide-y divide-[var(--color-border)]">
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
    </div>
  );
}
