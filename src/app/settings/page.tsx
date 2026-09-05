import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { Checklist, PageHeader, Panel, StatusBanner } from "@/components/rivalhub";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { loadSettingsProfileReadiness } from "@/lib/my/readiness";

export default async function SettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login");

  const [user, readiness] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.userId), columns: { displayName: true, steamName: true, perfectName: true, steam64: true, steamProfileUrl: true, qq: true, liveStreamUrl: true } }),
    loadSettingsProfileReadiness(session.userId),
  ]);
  const readyItems = [
    ...(readiness.profile.state === "ready" ? [] : [{ label: readiness.profile.detail, state: readiness.profile.state === "unknown" ? "pending" as const : "blocked" as const, href: readiness.profile.cta.href }]),
    ...(readiness.education.state === "ready" ? [] : [{ label: readiness.education.detail, state: readiness.education.state === "unknown" || readiness.education.state === "waiting" ? "pending" as const : "blocked" as const, href: readiness.education.cta.href }]),
    ...readiness.competitiveProfiles.flatMap((profile) => profile.required && profile.state !== "ready" ? profile.blockers.map((label) => ({ label, state: profile.state === "unknown" ? "pending" as const : "blocked" as const, href: "/settings/competitive" })) : []),
  ];

  return <div className="space-y-6">
    <PageHeader title="设置与参赛资料" description="这里维护长期个人资料；报名和赛事资格只在具体赛事上下文中按冻结规则核验。" />
    {readiness.ready
      ? <StatusBanner tone="success" title="长期参赛资料已齐全" sub="具体赛事的报名、确认加入和首发资格仍会按该届冻结规则复核。" />
      : <StatusBanner tone="warn" title={`还缺 ${readyItems.length} 项长期参赛资料`} sub="完成以下项目可保持个人资料完整；具体赛事是否满足资格请在对应报名页查看。" />}

    <Panel label="参赛资料" contentClassName="p-5">
      <ProfileForm current={{ displayName: user?.displayName ?? null, steamName: user?.steamName ?? null, perfectName: user?.perfectName ?? null, steam64: user?.steam64 ?? null, steamProfileUrl: user?.steamProfileUrl ?? null, qq: user?.qq ?? null, liveStreamUrl: user?.liveStreamUrl ?? null }} />
    </Panel>
    {readyItems.length > 0 && <Panel label="下一步" contentClassName="p-0"><Checklist items={readyItems} /></Panel>}
  </div>;
}
