import Link from "next/link";
import { asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMemberships, teams, users } from "@/db/schema";
import { Marker, Panel } from "@/components/rivalhub";

export default async function TeamDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q?.trim() ?? "";
  const rows = await db.select({
    id: teams.id,
    slug: teams.slug,
    name: teams.name,
    description: teams.description,
    recruiting: teams.recruiting,
    status: teams.status,
    captainName: sql<string>`coalesce(${users.displayName}, ${users.perfectName}, ${users.steamName}, '未命名用户')`,
  }).from(teams).innerJoin(users, eq(users.id, teams.captainUserId)).where(query ? ilike(teams.name, `%${query}%`) : undefined).orderBy(asc(teams.name));
  const counts = await db.select({ teamId: teamMemberships.teamId, value: sql<number>`count(*)::int` }).from(teamMemberships).where(isNull(teamMemberships.endedAt)).groupBy(teamMemberships.teamId);
  const countByTeam = new Map(counts.map((row) => [row.teamId, row.value]));
  return <div className="container mx-auto px-4 py-12 sm:py-16"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><Marker sub="跨赛事延续的长期队伍身份">队伍</Marker><form className="flex gap-2"><input name="q" defaultValue={query} placeholder="搜索队名" className="h-10 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-sm" /><button className="h-10 border border-[var(--color-border)] px-4 text-sm">搜索</button></form></div>{rows.length === 0 ? <p className="py-16 text-center text-[var(--color-fg-dim)]">暂无符合条件的队伍</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rows.map((team) => <Link key={team.id} href={`/teams/${team.slug}`}><Panel className="h-full transition-colors hover:border-[var(--color-border-hi)]" pad={20}><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{team.name}</h2>{team.recruiting && team.status === "active" && <span className="font-mono text-[10px] text-[var(--color-accent)]">招募中</span>}</div><p className="mt-2 line-clamp-2 min-h-10 text-sm text-[var(--color-fg-mid)]">{team.description ?? "暂无简介"}</p><p className="mt-4 font-mono text-[11px] text-[var(--color-fg-dim)]">队长 {team.captainName} · {countByTeam.get(team.id) ?? 0} 名当前成员 · {team.status === "active" ? "活跃" : "已解散"}</p></Panel></Link>)}</div>}</div>;
}
