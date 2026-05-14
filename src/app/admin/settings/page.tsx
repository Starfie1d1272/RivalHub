import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { checkAdminSession } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/admin/ChangePasswordForm";
import { Panel, StatusPill, Marker } from "@/components/rivalhub";

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
] as const;

export default async function AdminSettingsPage() {
  const admin = (await checkAdminSession())!;
  const adminUser = await db.query.users.findFirst({
    where: eq(users.id, admin.userId),
    columns: { steamName: true },
  });
  const adminDisplayName = adminUser?.steamName ?? admin.email;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-10">
        <div>
          <Marker sub={`当前登录：${adminDisplayName}`}>系统设置</Marker>
        </div>

        {/* 修改密码 */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-fg)]">修改密码</h2>
          {admin.authSource === "root" ? (
            <ChangePasswordForm />
          ) : (
            <Panel pad={16} className="text-sm text-[var(--color-fg-mid)]">
              邮箱密码用户请在登录页或 Supabase Auth 流程中管理密码；此处仅用于 Root 紧急账号。
            </Panel>
          )}
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
                        <StatusPill status="必填" />
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-fg-mid)]">{label}</p>
                    <p className="text-xs text-[var(--color-fg-mid)] opacity-70">{description}</p>
                  </div>
                  <StatusPill status={isSet ? "已配置" : "未配置"} />
                </div>
              );
            })}
          </Panel>
        </section>
    </div>
  );
}
