import Link from "next/link";
import { and, desc, eq, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitionEntries, competitionEntryParticipants, seasons } from "@/db/schema";
import { Marker, Panel } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { presentCompetitionEntryParticipation, presentCompetitionEntryRegistration } from "@/lib/competition-entries/presentation";
import { presentSeasonStatus } from "@/lib/seasons/presentation";

// This dashboard is entirely viewer-specific and intentionally request-bound.
export const instant = false;

export default async function MyCompetitionsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my/competitions");
  const rows = await db.selectDistinct({ id: competitionEntries.id, name: competitionEntries.name, status: competitionEntries.registrationStatus, source: competitionEntries.source, representativeUserId: competitionEntries.representativeUserId, seasonName: seasons.name, seasonSlug: seasons.slug, seasonStatus: seasons.status, participantStatus: competitionEntryParticipants.status, createdAt: competitionEntries.createdAt }).from(competitionEntries).innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId)).leftJoin(competitionEntryParticipants, and(eq(competitionEntryParticipants.entryId, competitionEntries.id), eq(competitionEntryParticipants.userId, session.userId))).where(or(eq(competitionEntries.representativeUserId, session.userId), eq(competitionEntryParticipants.userId, session.userId))).orderBy(desc(competitionEntries.createdAt));
  return <div className="container mx-auto space-y-6 px-4 py-12 sm:py-16"><div className="flex flex-wrap items-end justify-between gap-3"><Marker sub="查看你负责或参与的赛事">我的赛事</Marker><Link className="text-sm text-[var(--color-accent)]" href="/my/teams">管理队伍 →</Link></div>{rows.length === 0 ? <Panel pad={24}><p className="text-sm text-[var(--color-fg-mid)]">你目前没有负责或参与的赛事。</p></Panel> : <div className="grid gap-4 sm:grid-cols-2">{rows.map((entry) => { const registration = presentCompetitionEntryRegistration(entry.status); const participant = presentCompetitionEntryParticipation(entry.participantStatus, entry.status); return <Link key={entry.id} href={`/${entry.seasonSlug}/register`}><Panel className="h-full transition-colors hover:border-[var(--color-border-hi)]" pad={20}><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] text-[var(--color-accent)]">赛事报名</p><h2 className="mt-1 text-lg font-semibold">{entry.name}</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{entry.seasonName}</p></div><span className="font-mono text-[10px]">{registration.label}</span></div><p className="mt-4 text-xs text-[var(--color-fg-mid)]">{entry.representativeUserId === session.userId ? "赛事负责人" : `成员状态 · ${participant.label}`} · 赛事 {presentSeasonStatus(entry.seasonStatus).label}</p></Panel></Link>; })}</div>}</div>;
}