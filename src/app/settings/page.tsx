import { Suspense } from "react";
import { RegistrationReturnLink } from "@/components/settings/RegistrationReturnLink";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { db } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { Checklist, PageHeader, Panel, StatusBanner } from "@/components/rivalhub";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { loadSettingsProfileReadiness } from "@/lib/my/readiness";

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ returnTo?: string | string[] }> }) {
  const session = await getUserSession();
  if (!session) redirect("/login");

  const [user] = await
    db.select({
      displayName: users.displayName,
      perfectName: users.perfectName,
      steam64: users.steam64,
      qq: users.qq,
      liveStreamUrl: users.liveStreamUrl,
      gameplayStyle: users.gameplayStyle,
      competitionHistory: users.competitionHistory,
      steamProfile: {
        personaName: steamProfiles.personaName,
        profileUrl: steamProfiles.profileUrl,
        avatarUrl: steamProfiles.avatarUrl,
      },
    }).from(users)
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(users.id, session.userId));

  return <div className="space-y-6">
    <RegistrationReturnLink href={(await searchParams)?.returnTo} />
    <PageHeader title="设置与参赛资料" description="这里维护个人资料；每届赛事会按本届规则检查报名和参赛资格。" />
    <Suspense fallback={<div className="min-h-28" role="status">正在核对参赛资料…</div>}>
      <SettingsReadiness userId={session.userId} />
    </Suspense>
    <Panel label="参赛资料" contentClassName="p-5">
      <ProfileForm current={{ displayName: user?.displayName ?? null, perfectName: user?.perfectName ?? null, steam64: user?.steam64 ?? null, steamProfile: user?.steamProfile?.personaName && user.steamProfile.profileUrl ? { personaName: user.steamProfile.personaName, profileUrl: user.steamProfile.profileUrl, avatarUrl: user.steamProfile.avatarUrl ?? null } : null, qq: user?.qq ?? null, liveStreamUrl: user?.liveStreamUrl ?? null, gameplayStyle: user?.gameplayStyle ?? null, competitionHistory: user?.competitionHistory ?? null }} />
    </Panel>

  </div>;
}

async function SettingsReadiness({ userId }: { userId: string }) {
  const readiness = await loadSettingsProfileReadiness(userId);
  const readyItems = [
    ...(readiness.profile.state === "ready" ? [] : [{ label: readiness.profile.detail, state: readiness.profile.state === "unknown" ? "pending" as const : "blocked" as const, href: readiness.profile.cta.href }]),
    ...(readiness.education.state === "ready" ? [] : [{ label: readiness.education.detail, state: readiness.education.state === "unknown" || readiness.education.state === "waiting" ? "pending" as const : "blocked" as const, href: readiness.education.cta.href }]),
    ...readiness.competitiveProfiles.flatMap((profile) => profile.required && profile.state !== "ready" ? profile.blockers.map((label) => ({ label, state: profile.state === "unknown" ? "pending" as const : "blocked" as const, href: "/settings/competitive" })) : []),
  ];

  return <>
    {readiness.ready
      ? <StatusBanner tone="success" title="参赛资料已齐全" sub="具体赛事的报名、确认加入和首发资格仍会按本届规则复核。" />
      : <StatusBanner tone="warn" title={`还缺 ${readyItems.length} 项参赛资料`} sub="完成以下项目可保持个人资料完整；具体赛事是否满足资格请在对应报名页查看。" />}

    {readyItems.length > 0 && <Panel label="下一步" contentClassName="p-0"><Checklist items={readyItems} /></Panel>}
  </>;
}
