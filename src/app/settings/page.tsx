import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { db } from "@/db/client";
import { competitivePlatformSeasons, users } from "@/db/schema";
import { Checklist, Marker, Panel, StatusBanner } from "@/components/rivalhub";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { getParticipantReadiness } from "@/lib/major/participant-readiness";

export default async function SettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login");

  const [user, catalog] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.userId), columns: { displayName: true, steamName: true, perfectName: true, perfectId: true, steam64: true, steamProfileUrl: true, qq: true } }),
    db.select().from(competitivePlatformSeasons).orderBy(asc(competitivePlatformSeasons.platform), asc(competitivePlatformSeasons.sortOrder)),
  ]);
  const current = catalog.find((item) => item.active && item.isCurrent);
  const previous = current ? catalog.filter((item) => item.platform === current.platform && item.active && item.sortOrder < current.sortOrder).at(-1) : null;
  const readiness = current && previous ? await getParticipantReadiness(session.userId, { platform: current.platform, currentSeasonKey: current.seasonKey, previousSeasonKey: previous.seasonKey, rankOrder: current.rankOrder }) : null;
  const readyItems = readiness?.blockers.map((blocker) => ({
    label: blocker,
    state: "blocked" as const,
    href: blocker.includes("高校") ? "/settings/education" : blocker.includes("竞技") || blocker.includes("段位") || blocker.includes("Rating") ? "/settings/competitive" : "/settings",
  })) ?? [];

  return <div className="space-y-6">
    <div className="space-y-2"><Marker sub="参赛资料、教育认证与竞技档案会在报名和赛务节点重新核验">设置与参赛资料</Marker></div>
    {readiness ? readiness.ready
      ? <StatusBanner tone="success" title="READY TO COMPETE" sub="Major 参赛资料已齐全。报名、确认加入和首发仍会按当时资料复核。" />
      : <StatusBanner tone="warn" title={`还缺 ${readiness.blockers.length} 项参赛资料`} sub="完成以下项目后即可满足 Major 的个人资料要求。" />
      : <StatusBanner tone="info" title="参赛资料入口" sub="平台赛季目录尚未完成当前与上一赛季配置；你仍可先完善个人资料与教育认证。" />}

    <Panel label="参赛资料" pad={20}>
      <ProfileForm current={{ displayName: user?.displayName ?? null, steamName: user?.steamName ?? null, perfectName: user?.perfectName ?? null, perfectId: user?.perfectId ?? null, steam64: user?.steam64 ?? null, steamProfileUrl: user?.steamProfileUrl ?? null, qq: user?.qq ?? null }} />
    </Panel>
    {readyItems.length > 0 && <Panel label="下一步" pad={0}><Checklist items={readyItems} /></Panel>}
  </div>;
}
