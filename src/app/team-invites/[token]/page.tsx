import Link from "next/link";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { teamInvitations, teams } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { Panel, StatusBanner } from "@/components/rivalhub";
import { ClaimTeamInviteButton } from "@/components/register/ClaimTeamInviteButton";
import { presentTeamShareInvitation } from "@/lib/teams/presentation";

export const instant = false;

export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) notFound();
  const hash = createHash("sha256").update(token).digest("hex");
  const [invite] = await db.select({
    teamName: teams.name,
    teamStatus: teams.status,
    status: teamInvitations.status,
    expiresAt: teamInvitations.expiresAt,
  }).from(teamInvitations).innerJoin(teams, eq(teamInvitations.teamId, teams.id))
    .where(and(eq(teamInvitations.kind, "share_link"), eq(teamInvitations.tokenHash, hash))).limit(1);
  if (!invite) notFound();
  const presentation = presentTeamShareInvitation(invite);
  const next = `/team-invites/${token}`;
  const session = presentation.canAccept ? await getUserSession() : null;
  return <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10"><Panel className="w-full" pad={28}>
    <div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">TEAM INVITATION</p><h1 className="mt-2 text-2xl font-semibold">{presentation.canAccept ? `加入 ${invite.teamName}` : presentation.title}</h1></div>
      <StatusBanner tone={presentation.canAccept ? "info" : "warn"} title={presentation.title} sub={presentation.sub} />
      {presentation.canAccept && (session ? <ClaimTeamInviteButton token={token} /> : <div className="flex flex-wrap gap-2"><Link className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]" href={`/login?next=${encodeURIComponent(next)}`}>登录后加入</Link><Link className="rounded-sm border border-[var(--color-border)] px-4 py-2 text-sm font-medium" href={`/login?mode=register&next=${encodeURIComponent(next)}`}>注册后加入</Link></div>)}
    </div>
  </Panel></div>;
}
