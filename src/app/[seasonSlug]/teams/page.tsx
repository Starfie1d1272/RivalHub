import { publicCompetitionEntryCondition, publicCompetitionEntryLabel } from "@/lib/competition-entries/public-visibility";
import { Suspense } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, matches, users } from "@/db/schema";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { PageHeader, PageLayout, Stat } from "@/components/rivalhub";
import { TeamCard } from "@/components/teams/TeamCard";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

export default async function CompetitionEntriesPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const entries = await db.query.competitionEntries.findMany({ where: and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition()), orderBy: [asc(competitionEntries.formationOrder), asc(competitionEntries.createdAt)] });
  if (entries.length === 0) return <div className="container mx-auto px-4 py-16 text-center text-[var(--color-fg-mid)]">赛事队伍尚未形成</div>;
  const members = await db.select({ entryId: eventRosters.entryId, userId: users.id, steamName: users.steamName, perfectName: users.perfectName, displayName: users.displayName, isStarter: eventRosterMembers.isPrimaryStarter })
    .from(eventRosterMembers).innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId)).innerJoin(users, eq(users.id, eventRosterMembers.userId)).where(inArray(eventRosters.entryId, entries.map((entry) => entry.id)));
  const seasonMatches = await db.query.matches.findMany({ where: eq(matches.seasonId, season.id) });
  const membersByEntry = new Map<string, typeof members>();
  for (const member of members) membersByEntry.set(member.entryId, [...(membersByEntry.get(member.entryId) ?? []), member]);
  const record = (entryId: string) => { let wins = 0; let losses = 0; for (const match of seasonMatches) { if (match.status !== "finished" || (match.entryAId !== entryId && match.entryBId !== entryId)) continue; const own = match.entryAId === entryId ? match.scoreA : match.scoreB; const other = match.entryAId === entryId ? match.scoreB : match.scoreA; if ((own ?? 0) > (other ?? 0)) wins += 1; else losses += 1; } const played = wins + losses; return { played, wins, losses, winRate: played ? `${Math.round(wins / played * 100)}%` : "—" }; };
  return <PageLayout as="div" variant="wide" className="space-y-8">
    <PageHeader title={publicCompetitionEntryLabel(season)} eyebrow={season.name} actions={<Suspense fallback={null}><AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} label="赛事管理" /></Suspense>} />
    <div className="grid grid-cols-3 gap-3 sm:gap-4"><Stat label={publicCompetitionEntryLabel(season)} value={entries.length} /><Stat label="正式选手" value={members.length} /><Stat label="比赛" value={`${seasonMatches.filter((match) => match.status === "finished").length}/${seasonMatches.length}`} /></div>
    <p className="text-xs text-[var(--color-fg-dim)]">{season.registrationMode === "team" && season.status === "registration" ? "审核通过后进入正赛候选池，正式正赛名额由赛委会确认。" : "这里展示本届赛事队伍；队伍资料与历史请到队伍页面查看。"}</p>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{entries.map((entry) => <TeamCard key={entry.id} entryId={entry.id} teamName={entry.name} seasonSlug={seasonSlug} draftOrder={entry.formationOrder} logoUrl={entry.logoUrl} players={(membersByEntry.get(entry.id) ?? []).map((member) => ({ name: getPublicDisplayName(member), isStarter: member.isStarter, isRepresentative: member.userId === entry.representativeUserId, userId: member.userId }))} record={record(entry.id)} summary={null} />)}</div>
  </PageLayout>;
}
