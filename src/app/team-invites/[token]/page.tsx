import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { seasons, teamApplications } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { Panel, StatusBanner } from "@/components/rivalhub";
import { ClaimTeamInviteButton } from "@/components/register/ClaimTeamInviteButton";

export const dynamic = "force-dynamic";

export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) notFound();
  const [invite] = await db.select({
    teamName: teamApplications.name,
    status: teamApplications.status,
    seasonName: seasons.name,
    seasonSlug: seasons.slug,
  }).from(teamApplications).innerJoin(seasons, eq(teamApplications.seasonId, seasons.id))
    .where(eq(teamApplications.joinToken, token)).limit(1);
  if (!invite || !["draft", "rejected"].includes(invite.status)) notFound();
  const session = await getUserSession();
  const next = `/team-invites/${token}`;
  return <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10"><Panel className="w-full" pad={28}>
    <div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">TEAM INVITATION</p><h1 className="mt-2 text-2xl font-semibold">加入 {invite.teamName}</h1><p className="mt-2 text-sm text-[var(--color-fg-mid)]">{invite.seasonName}</p></div>
      <StatusBanner tone="info" title="这是报名队伍邀请" sub="加入后不会自动确认参赛；你仍需完成个人资料，并亲自确认赛事规则与隐私说明。" />
      {session ? <ClaimTeamInviteButton token={token} /> : <div className="flex flex-wrap gap-2"><Link className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]" href={`/login?next=${encodeURIComponent(next)}`}>登录后加入</Link><Link className="rounded-sm border border-[var(--color-border)] px-4 py-2 text-sm font-medium" href={`/login?mode=register&next=${encodeURIComponent(next)}`}>注册后加入</Link></div>}
    </div>
  </Panel></div>;
}
