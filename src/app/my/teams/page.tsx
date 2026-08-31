import Link from "next/link";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { teamInvitations, teamMemberships, teams, users } from "@/db/schema";
import { LongLivedTeamWorkspace } from "@/components/teams/LongLivedTeamWorkspace";
import { Marker, Panel } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { toLongLivedTeamDto } from "@/lib/teams/workspace";

const publicName = sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未命名用户')`;

export default async function MyTeamsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my/teams");
  const periods = await db.select({
    membership: { id: teamMemberships.id, userId: teamMemberships.userId, role: teamMemberships.role, status: teamMemberships.status, startedAt: teamMemberships.startedAt, endedAt: teamMemberships.endedAt },
    team: { id: teams.id, slug: teams.slug, name: teams.name, description: teams.description, recruiting: teams.recruiting, captainUserId: teams.captainUserId, status: teams.status },
  }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(eq(teamMemberships.userId, session.userId)).orderBy(desc(teamMemberships.startedAt));
  const current = periods.find((row) => row.membership.endedAt === null && row.membership.status === "active" && row.team.status === "active") ?? null;
  const [members, incoming, outgoing] = await Promise.all([
    current ? db.select({ id: teamMemberships.id, userId: teamMemberships.userId, name: publicName, status: teamMemberships.status, role: teamMemberships.role }).from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId)).where(and(eq(teamMemberships.teamId, current.team.id), isNull(teamMemberships.endedAt))) : Promise.resolve([]),
    db.select({ id: teamInvitations.id, teamId: teams.id, teamName: teams.name, expiresAt: teamInvitations.expiresAt }).from(teamInvitations).innerJoin(teams, eq(teams.id, teamInvitations.teamId)).where(and(eq(teamInvitations.kind, "direct"), eq(teamInvitations.invitedUserId, session.userId), eq(teamInvitations.status, "pending"), gt(teamInvitations.expiresAt, new Date()))),
    current && current.team.captainUserId === session.userId ? db.select({ id: teamInvitations.id, teamId: teams.id, teamName: teams.name, expiresAt: teamInvitations.expiresAt }).from(teamInvitations).innerJoin(teams, eq(teams.id, teamInvitations.teamId)).where(and(eq(teamInvitations.teamId, current.team.id), eq(teamInvitations.status, "pending"), gt(teamInvitations.expiresAt, new Date()))) : Promise.resolve([]),
  ]);
  return <div className="container mx-auto space-y-6 px-4 py-12 sm:py-16"><div className="flex flex-wrap items-end justify-between gap-3"><Marker sub="管理队伍成员、资料与赛事报名">我的队伍</Marker><Link className="text-sm text-[var(--color-accent)]" href="/my/competitions">查看我的赛事 →</Link></div><LongLivedTeamWorkspace currentUserId={session.userId} team={current ? toLongLivedTeamDto(current.team) : null} memberships={members} incomingInvitations={incoming.map((item) => ({ ...item, expiresAt: item.expiresAt.toISOString() }))} outgoingInvitations={outgoing.map((item) => ({ ...item, expiresAt: item.expiresAt.toISOString() }))} />{periods.length > 0 && <Panel label="成员历史" pad={20}><div className="space-y-2">{periods.map((row) => <Link key={row.membership.id} href={`/teams/${row.team.slug}`} className="flex flex-wrap justify-between gap-2 border-b border-[var(--color-border)] py-2 text-sm"><span>{row.team.name} · {row.membership.role === "captain" ? "队长" : "成员"}</span><span className="text-[var(--color-fg-mid)]">{row.membership.startedAt.toLocaleDateString("zh-CN")} — {row.membership.endedAt?.toLocaleDateString("zh-CN") ?? "至今"} · {row.membership.status}</span></Link>)}</div></Panel>}</div>;
}
