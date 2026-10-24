import { getPublicCompetitionEntryDirectory } from "@/lib/competition-entries/public-directory";
import Link from "next/link";
import { connection } from "next/server";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { ParticipantDirectoryToolbar } from "@/components/season/ParticipantDirectoryToolbar";
import { parseParticipantDirectoryQuery, matchesDirectorySearch } from "@/lib/players/directory-query";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { TeamCard } from "@/components/teams/TeamCard";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantSummary } from "@/lib/major/public-participants";

export default function CompetitionEntriesPage(props: { params: Promise<{ seasonSlug: string }>; searchParams?: Promise<{ q?: string }> }) {
  return <Suspense fallback={<PageLayout variant="wide" aria-busy="true"><span className="sr-only">正在加载参赛阵容…</span><div className="h-28" /><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map(index => <div key={index} className="h-64 animate-pulse border border-[var(--color-border)] bg-[var(--color-panel-low)]" />)}</div></PageLayout>}><CompetitionEntriesPageContent {...props} /></Suspense>;
}
export async function CompetitionEntriesPageContent({ params, searchParams }: { params: Promise<{ seasonSlug: string }>; searchParams?: Promise<{ q?: string }> }) {
  await connection();
  const { seasonSlug } = await params;
  const { q } = parseParticipantDirectoryQuery(await searchParams);
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  if (season.competitionTemplate === "major") {
    const [summary, results] = await Promise.all([getMajorPublicParticipantSummary(season), getPublicSeasonResults(season)]);

    const visibleTeams = summary.teams.filter((team) => matchesDirectorySearch(q, team.entry.name, ...team.roster.map((member) => member.name)));
    return <PageLayout as="div" variant="wide" className="space-y-6">
      <PageHeader
        title="参赛阵容"
        eyebrow={season.name}
        actions={<Suspense fallback={null}><AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} label="赛事管理" /></Suspense>}
      />
      <p className="text-sm text-[var(--color-fg-mid)]">{summary.teamCount} 支队伍 · {summary.playerCount} 名选手 · {summary.finishedMatchCount}/{summary.matchCount} 场比赛已结束</p>
      <ParticipantDirectoryToolbar query={q} total={visibleTeams.length} />
      {visibleTeams.length === 0 ? (
        <div className="py-16 text-center text-[var(--color-fg-mid)]">{q ? "没有匹配的队伍或选手" : `${summary.presentation.teamCollectionLabel}尚未形成`}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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

  const [{ entries, members, matchSummary, teamCount, playerCount }, results] = await Promise.all([getPublicCompetitionEntryDirectory(season), getPublicSeasonResults(season)]);
  const membersByEntry = new Map<string, typeof members>();
  for (const member of members) membersByEntry.set(member.entryId, [...(membersByEntry.get(member.entryId) ?? []), member]);
  const visibleEntries = entries.filter((entry) => matchesDirectorySearch(q, entry.name, ...(membersByEntry.get(entry.id) ?? []).map(getPublicDisplayName)));
  return <PageLayout as="div" variant="wide" className="space-y-6">
    <PageHeader title="参赛阵容" eyebrow={season.name} actions={<Suspense fallback={null}><AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} label="赛事管理" /></Suspense>} />
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-[var(--color-fg-mid)]">{teamCount} 支队伍 · {playerCount} 名确认选手 · {matchSummary.finished}/{matchSummary.total} 场比赛已结束</p>
      {season.competitionTemplate === "rivals" && <Link className="text-[var(--color-accent)] hover:underline" href={`/${seasonSlug}/players`}>报名名单与候选人 →</Link>}
    </div>
    <ParticipantDirectoryToolbar query={q} total={visibleEntries.length} />
    {visibleEntries.length === 0 ? (
      <div className="py-16 text-center text-[var(--color-fg-mid)]">{q ? "没有匹配的队伍或选手" : "赛事队伍尚未形成"}</div>
    ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visibleEntries.toSorted((a, b) => (results.placements.findIndex(p => p.entryId === a.id) + 1 || Infinity) - (results.placements.findIndex(p => p.entryId === b.id) + 1 || Infinity)).map((entry) => <TeamCard query={q} placement={results.placements.find((placement) => placement.entryId === entry.id)?.label} key={entry.id} entryId={entry.id} teamName={entry.name} seasonSlug={seasonSlug} logoUrl={entry.logoUrl} players={(membersByEntry.get(entry.id) ?? []).map((member) => ({ name: getPublicDisplayName(member), avatarUrl: member.avatarUrl, hasActivePublicSanction: member.hasActivePublicSanction, isStarter: member.isStarter, userId: member.userId }))} />)}</div>
    )}
  </PageLayout>;
}
