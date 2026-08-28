import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { db } from "@/db/client";
import { seasons, users } from "@/db/schema";
import { Checklist, Marker, Panel, StatusBanner } from "@/components/rivalhub";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { getParticipantReadiness } from "@/lib/major/participant-readiness";
import { normalizeTeamRegistrationConfig } from "@/types/season";

export default async function SettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login");

  const [user, seasonRows] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.userId), columns: { displayName: true, steamName: true, perfectName: true, perfectId: true, steam64: true, steamProfileUrl: true, qq: true } }),
    db.query.seasons.findMany({ orderBy: [desc(seasons.updatedAt)] }),
  ]);
  const majorConfig = seasonRows.map((season) => normalizeTeamRegistrationConfig(season.teamRegistrationConfig)).find((config) => config.requireCompetitiveProfile)?.competitiveProfile ?? null;
  const readiness = majorConfig ? await getParticipantReadiness(session.userId, majorConfig) : null;
  const readyItems = readiness?.blockers.map((blocker) => ({
    label: blocker,
    state: "blocked" as const,
    href: blocker.includes("高校") ? "/settings/education" : blocker.includes("竞技") || blocker.includes("段位") || blocker.includes("Rating") ? "/settings/competitive" : "/settings",
  })) ?? [];

  return <main className="container mx-auto max-w-4xl space-y-6 px-4 py-10">
    <div className="space-y-2"><Marker sub="参赛资料、教育认证与竞技档案会在报名和赛务节点由服务器重新核验">设置与参赛资料</Marker></div>
    {readiness ? readiness.ready
      ? <StatusBanner tone="success" title="READY TO COMPETE" sub="Major 参赛资料已齐全。报名、确认加入和首发仍会按当时资料复核。" />
      : <StatusBanner tone="warn" title={`还缺 ${readiness.blockers.length} 项参赛资料`} sub="完成以下项目后即可满足 Major 的个人资料要求。" />
      : <StatusBanner tone="info" title="参赛资料入口" sub="当前没有已配置的 Major 竞技档案规则；仍可先完善个人资料与教育认证。" />}

    <div className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
      <Panel label="参赛资料" pad={20}>
        <ProfileForm current={{ displayName: user?.displayName ?? null, steamName: user?.steamName ?? null, perfectName: user?.perfectName ?? null, perfectId: user?.perfectId ?? null, steam64: user?.steam64 ?? null, steamProfileUrl: user?.steamProfileUrl ?? null, qq: user?.qq ?? null }} />
      </Panel>
      <div className="space-y-4">
        <Panel label="参赛资料导航" pad={0}>
          <nav className="divide-y divide-[var(--color-border)]">
            <Link href="/settings" className="block px-4 py-3 hover:bg-[var(--color-panel-hi)]"><span className="text-sm font-medium">参赛资料</span><span className="mt-1 block font-mono text-[11px] text-[var(--color-fg-mid)]">展示昵称、Steam64、完美平台 ID 与 QQ</span></Link>
            <Link href="/settings/education" className="block px-4 py-3 hover:bg-[var(--color-panel-hi)]"><span className="text-sm font-medium">教育身份</span><span className="mt-1 block font-mono text-[11px] text-[var(--color-fg-mid)]">高校邮箱、学信网材料与审核记录</span></Link>
            <Link href="/settings/competitive" className="block px-4 py-3 hover:bg-[var(--color-panel-hi)]"><span className="text-sm font-medium">竞技档案</span><span className="mt-1 block font-mono text-[11px] text-[var(--color-fg-mid)]">历史、上一赛季与当前赛季最高段位</span></Link>
            <Link href="/settings/password" className="block px-4 py-3 hover:bg-[var(--color-panel-hi)]"><span className="text-sm font-medium">账号与安全</span><span className="mt-1 block font-mono text-[11px] text-[var(--color-fg-mid)]">密码与登录安全</span></Link>
            <Link href="/privacy" className="block px-4 py-3 hover:bg-[var(--color-panel-hi)]"><span className="text-sm font-medium">隐私</span><span className="mt-1 block font-mono text-[11px] text-[var(--color-fg-mid)]">公开资料与仅供审核使用的资料范围</span></Link>
          </nav>
        </Panel>
        {readyItems.length > 0 && <Panel label="下一步" pad={0}><Checklist items={readyItems} /></Panel>}
      </div>
    </div>
  </main>;
}
