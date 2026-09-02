import Link from "next/link";
import { and, asc, eq, gt, ilike, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { recruitmentIntents, teamMemberships, teams, users } from "@/db/schema";
import { EmptyState, Marker } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TeamDirectoryCard } from "@/components/teams/TeamDirectoryCard";
import { getUserSession } from "@/lib/auth/session";
import { TeamSectionNav } from "@/components/teams/TeamSectionNav";

export default async function TeamDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q }, session] = await Promise.all([searchParams, getUserSession()]);
  const query = q?.trim() ?? "";
  const [rows, counts, currentTeamRows] = await Promise.all([
    db.select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      logoUrl: teams.logoUrl,
      description: teams.description,
      hasOpenRecruitment: sql<boolean>`${recruitmentIntents.id} IS NOT NULL`,
      status: teams.status,
      captainName: sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未命名用户')`,
    }).from(teams).innerJoin(users, eq(users.id, teams.captainUserId)).leftJoin(recruitmentIntents, and(eq(recruitmentIntents.teamId, teams.id), eq(recruitmentIntents.kind, "team_recruiting"), eq(recruitmentIntents.status, "open"), gt(recruitmentIntents.expiresAt, new Date()))).where(query ? ilike(teams.name, `%${query}%`) : undefined).orderBy(asc(teams.name)),
    db.select({ teamId: teamMemberships.teamId, value: sql<number>`count(*)::int` }).from(teamMemberships).where(isNull(teamMemberships.endedAt)).groupBy(teamMemberships.teamId),
    session
      ? db.select({ slug: teams.slug }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(and(eq(teamMemberships.userId, session.userId), isNull(teamMemberships.endedAt), eq(teams.status, "active"))).limit(1)
      : Promise.resolve([]),
  ]);
  const countByTeam = new Map(counts.map((row) => [row.teamId, row.value]));
  const currentTeam = currentTeamRows[0] ?? null;
  return <div className="container mx-auto max-w-6xl px-4 py-12 sm:py-16"><div className="mb-8 space-y-5"><div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><Marker sub="查看队伍、成员和赛事履历">队伍</Marker><div className="flex w-full flex-col gap-3 md:w-auto md:items-end">{session && <Button size="sm" asChild><Link href={currentTeam ? "/my/teams" : "/my/teams#create-team"}>{currentTeam ? "管理我的队伍" : "创建队伍"}</Link></Button>}<form className="flex w-full max-w-md gap-2 sm:max-w-sm"><Input name="q" defaultValue={query} placeholder="搜索队名" className="min-w-0" /><Button type="submit" variant="outline">搜索</Button></form></div></div><TeamSectionNav active="directory" /></div>{rows.length === 0 ? <EmptyState title="没有找到符合条件的队伍" /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rows.map((team) => <TeamDirectoryCard key={team.id} slug={team.slug} name={team.name} logoUrl={team.logoUrl} description={team.description} hasOpenRecruitment={team.hasOpenRecruitment} status={team.status} captainName={team.captainName} memberCount={countByTeam.get(team.id) ?? 0} />)}</div>}</div>;
}
