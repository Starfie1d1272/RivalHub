import Link from "next/link";
import { connection } from "next/server";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { ParticipantDirectoryToolbar } from "@/components/season/ParticipantDirectoryToolbar";
import { parseParticipantDirectoryQuery, matchesDirectorySearch } from "@/lib/players/directory-query";
import { publicCompetitionEntryCondition, publicCompetitionEntryLabel } from "@/lib/competition-entries/public-visibility";
import { Suspense } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, steamProfiles, users } from "@/db/schema";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { PageHeader, PageLayout, Stat } from "@/components/rivalhub";
import { TeamCard } from "@/components/teams/TeamCard";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicEventTeamMatchSummary } from "@/lib/competition-entries/public-team-context";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantSummary } from "@/lib/major/public-participants";

export default function CompetitionEntriesPage(props: { params: Promise<{ seasonSlug: string }>; searchParams?: Promise<{ q?: string }> }) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status">正在加载…</p></PageLayout>}><CompetitionEntriesPageContent {...props} /></Suspense>;
}
export async function CompetitionEntriesPageContent({ params, searchParams }: { params: Promise<{ seasonSlug: string }>; searchParams?: Promise<{ q?: string }> }) {
  await connection();
  const { seasonSlug } = await params;
  const { q } = parseParticipantDirectoryQuery(await searchParams);
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  if (season.competitionTemplate === "major") {
    const summary = await getMajorPublicParticipantSummary(season);

    const visibleTeams = summary.teams.filter((team) => matchesDirectorySearch(q, team.entry.name, ...team.roster.map((member) => member.name)));
    const results = await getPublicSeasonResults(season);
    return <PageLayout as="div" variant="wide" className="space-y-6">
      <PageHeader
        title="参赛阵容"
        eyebrow={season.name}
        description={summary.presentation.teamCollectionDescription}
        actions={<Suspense fallback={null}><AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} label="赛事管理" /></Suspense>}
      />
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="队伍" value={summary.teamCount} />
        <Stat label="选手" value={summary.playerCount} />
        <Stat label="比赛" value={`${summary.finishedMatchCount}/${summary.matchCount}`} />
      </div>
      <ParticipantDirectoryToolbar query={q} total={visibleTeams.length} />
      {visibleTeams.length === 0 ? (
        <div className="py-16 text-center text-[var(--color-fg-mid)]">{q ? "没有匹配的队伍或选手" : `${summary.presentation.teamCollectionLabel}尚未形成`}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleTeams.toSorted((a, b) => (results.placements.findIndex(p => p.entryId === a.entry.id) + 1 || Infinity) - (results.placements.findIndex(p => p.entryId === b.entry.id) + 1 || Infinity)).map((team) => (
            <TeamCard
              key={team.entry.id}
              entryId={team.entry.id}
              teamName={team.entry.name}
              seasonSlug={seasonSlug}
              logoUrl={team.entry.logoUrl}
              players={team.roster}
              query={q}
              placement={results.placements.find((placement) => placement.entryId === team.entry.id)?.label}
            />
          ))}
        </div>
      )}
    </PageLayout>;
  }

  const entries = await db.query.competitionEntries.findMany({ where: and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition()), orderBy: [asc(competitionEntries.formationOrder), asc(competitionEntries.id)] });
  const members = await db.select({ entryId: eventRosters.entryId, userId: users.id, personaName: steamProfiles.personaName, avatarUrl: steamProfiles.avatarUrl, perfectName: users.perfectName, displayName: users.displayName, isStarter: eventRosterMembers.isPrimaryStarter })
    .from(eventRosterMembers).innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId)).innerJoin(users, eq(users.id, eventRosterMembers.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(and(inArray(eventRosters.entryId, entries.map((entry) => entry.id)), inArray(eventRosters.status, ["confirmed", "frozen"]), eq(eventRosterMembers.isCurrent, true)));
  const matchSummary = await getPublicEventTeamMatchSummary(season.id, entries.map((entry) => entry.id));
  const membersByEntry = new Map<string, typeof members>();
  for (const member of members) membersByEntry.set(member.entryId, [...(membersByEntry.get(member.entryId) ?? []), member]);
  const visibleEntries = entries.filter((entry) => matchesDirectorySearch(q, entry.name, ...(membersByEntry.get(entry.id) ?? []).map(getPublicDisplayName)));
  const results = await getPublicSeasonResults(season);
  return <PageLayout as="div" variant="wide" className="space-y-6">
    <PageHeader title="参赛阵容" eyebrow={season.name} description={publicCompetitionEntryLabel(season)} actions={<Suspense fallback={null}><AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} label="赛事管理" /></Suspense>} />
    <div className="grid grid-cols-3 gap-3 sm:gap-4"><Stat label="队伍" value={entries.length} /><Stat label="已确认选手" value={members.length} /><Stat label="比赛" value={`${matchSummary.finished}/${matchSummary.total}`} /></div>
    {season.competitionTemplate === "rivals" && <Link className="inline-flex min-h-10 items-center text-sm text-[var(--color-accent)] hover:underline" href={`/${seasonSlug}/players`}>报名名单与候选人 →</Link>}
    <ParticipantDirectoryToolbar query={q} total={visibleEntries.length} />
    {visibleEntries.length === 0 ? (
      <div className="py-16 text-center text-[var(--color-fg-mid)]">{q ? "没有匹配的队伍或选手" : "赛事队伍尚未形成"}</div>
    ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleEntries.toSorted((a, b) => (results.placements.findIndex(p => p.entryId === a.id) + 1 || Infinity) - (results.placements.findIndex(p => p.entryId === b.id) + 1 || Infinity)).map((entry) => <TeamCard query={q} placement={results.placements.find((placement) => placement.entryId === entry.id)?.label} key={entry.id} entryId={entry.id} teamName={entry.name} seasonSlug={seasonSlug} logoUrl={entry.logoUrl} players={(membersByEntry.get(entry.id) ?? []).map((member) => ({ name: getPublicDisplayName(member), avatarUrl: member.avatarUrl, isStarter: member.isStarter, userId: member.userId }))} />)}</div>
    )}
  </PageLayout>;
}
