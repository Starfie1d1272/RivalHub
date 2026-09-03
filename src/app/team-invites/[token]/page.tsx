import Link from "next/link";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { teamInvitations, teams } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { Panel, StatusBanner } from "@/components/rivalhub";
import { ClaimTeamInviteButton } from "@/components/register/ClaimTeamInviteButton";

export const instant = false;

export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) notFound();
  const hash = createHash("sha256").update(token).digest("hex");
  const [invite] = await db.select({
    teamName: teams.name,
  }).from(teamInvitations).innerJoin(teams, eq(teamInvitations.teamId, teams.id))
    .where(and(eq(teamInvitations.tokenHash, hash), eq(teamInvitations.status, "pending"), gt(teamInvitations.expiresAt, new Date()), eq(teams.status, "active"))).limit(1);
  if (!invite) notFound();
  const session = await getUserSession();
  const next = `/team-invites/${token}`;
  return <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10"><Panel className="w-full" pad={28}>
    <div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">TEAM INVITATION</p><h1 className="mt-2 text-2xl font-semibold">加入 {invite.teamName}</h1></div>
      <StatusBanner tone="info" title="这是队伍邀请" sub="加入队伍不等于参加任何赛事；参赛时仍需在对应赛事中确认名单。" />
      {session ? <ClaimTeamInviteButton token={token} /> : <div className="flex flex-wrap gap-2"><Link className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]" href={`/login?next=${encodeURIComponent(next)}`}>登录后加入</Link><Link className="rounded-sm border border-[var(--color-border)] px-4 py-2 text-sm font-medium" href={`/login?mode=register&next=${encodeURIComponent(next)}`}>注册后加入</Link></div>}
    </div>
  </Panel></div>;
}
