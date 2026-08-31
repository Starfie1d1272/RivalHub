import Link from "next/link";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitionEntries, matches, seasons, teamCaptainChanges, teamMemberships, teamNameChanges, teamSlugAliases, teams, users } from "@/db/schema";
import { Marker, Panel } from "@/components/rivalhub";
import { formatCSTShortDate } from "@/lib/utils/date";
import { presentCompetitionEntryRegistration } from "@/lib/competition-entries/presentation";
import { presentTeamMembershipStatus, presentTeamStatus } from "@/lib/teams/presentation";

const publicName = sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未命名用户')`;

export default async function TeamProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let team = await db.query.teams.findFirst({ where: eq(teams.slug, slug) });
  if (!team) {
    const alias = await db.query.teamSlugAliases.findFirst({ where: eq(teamSlugAliases.slug, slug) });
    if (alias) {
      team = await db.query.teams.findFirst({ where: eq(teams.id, alias.teamId) });
      if (team) redirect(`/teams/${team.slug}`);
    }
  }
  if (!team) notFound();
  const [members, names, captains, entries] = await Promise.all([
    db.select({ id: teamMemberships.id, userId: users.id, name: publicName, status: teamMemberships.status, startedAt: teamMemberships.startedAt, endedAt: teamMemberships.endedAt }).from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId)).where(eq(teamMemberships.teamId, team!.id)).orderBy(asc(teamMemberships.startedAt)),
    db.select().from(teamNameChanges).where(eq(teamNameChanges.teamId, team!.id)).orderBy(asc(teamNameChanges.changedAt)),
    db.select({ id: teamCaptainChanges.id, name: publicName, changedAt: teamCaptainChanges.changedAt }).from(teamCaptainChanges).innerJoin(users, eq(users.id, teamCaptainChanges.toUserId)).where(eq(teamCaptainChanges.teamId, team!.id)).orderBy(asc(teamCaptainChanges.changedAt)),
    db.select({ id: competitionEntries.id, name: competitionEntries.name, status: competitionEntries.registrationStatus, seasonName: seasons.name, seasonSlug: seasons.slug, createdAt: competitionEntries.createdAt }).from(competitionEntries).innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId)).where(eq(competitionEntries.teamId, team!.id)).orderBy(desc(competitionEntries.createdAt)),
  ]);
  const entryIds = entries.map((entry) => entry.id);
  const played = entryIds.length ? await db.select({ entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB, status: matches.status }).from(matches).where(and(eq(matches.status, "finished"), or(sql`${matches.entryAId} = ANY(${entryIds}::uuid[])`, sql`${matches.entryBId} = ANY(${entryIds}::uuid[])`))) : [];
  const wins = played.filter((match) => (entryIds.includes(match.entryAId) && (match.scoreA ?? 0) > (match.scoreB ?? 0)) || (entryIds.includes(match.entryBId) && (match.scoreB ?? 0) > (match.scoreA ?? 0))).length;
  const current = members.filter((member) => member.endedAt === null);
  return <div className="container mx-auto space-y-6 px-4 py-12 sm:py-16"><div><Marker sub={`${presentTeamStatus(team.status).label} · ${current.length} 名当前成员`}>{team.name}</Marker><p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--color-fg-mid)]">{team.description ?? "暂无队伍简介。"}</p>{team.recruiting && team.status === "active" && <p className="mt-3 font-mono text-xs text-[var(--color-accent)]">正在招募</p>}</div><div className="grid gap-5 lg:grid-cols-2"><Panel label="当前成员" pad={20}><div className="space-y-2">{current.map((member) => <Link key={member.id} href={`/players/${member.userId}`} className="flex justify-between border-b border-[var(--color-border)] py-2 text-sm"><span>{member.name}{member.userId === team.captainUserId ? " · 队长" : ""}</span><span className="font-mono text-[10px] text-[var(--color-fg-mid)]">{presentTeamMembershipStatus(member.status).label}</span></Link>)}</div></Panel><Panel label="赛事履历" pad={20}><div className="mb-4 grid grid-cols-2 gap-3 text-sm"><div><p className="font-mono text-[10px] text-[var(--color-fg-mid)]">比赛场次</p><p className="text-2xl">{played.length}</p></div><div><p className="font-mono text-[10px] text-[var(--color-fg-mid)]">获胜场次</p><p className="text-2xl">{wins}</p></div></div><div className="space-y-2">{entries.length ? entries.map((entry) => <Link key={entry.id} href={`/${entry.seasonSlug}/teams/${entry.id}`} className="flex justify-between border-b border-[var(--color-border)] py-2 text-sm"><span>{entry.seasonName} · {entry.name}</span><span>{presentCompetitionEntryRegistration(entry.status).label}</span></Link>) : <p className="text-sm text-[var(--color-fg-mid)]">尚无赛事记录。</p>}</div></Panel><Panel label="名称历史" pad={20}><div className="space-y-2">{names.map((name) => <p key={name.id} className="text-sm">{name.oldName ? `${name.oldName} → ` : ""}{name.newName} · {formatCSTShortDate(name.changedAt)}</p>)}</div></Panel><Panel label="队长变更" pad={20}><div className="space-y-2">{captains.map((captain) => <p key={captain.id} className="text-sm">{captain.name} · {formatCSTShortDate(captain.changedAt)}</p>)}</div></Panel></div></div>;
}
