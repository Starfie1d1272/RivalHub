import { getBatchPublicTeamMapPreviews } from "@/lib/teams/map-profile";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { ParticipantDirectoryToolbar } from "@/components/season/ParticipantDirectoryToolbar";
import { parseParticipantDirectoryQuery, matchesDirectorySearch } from "@/lib/players/directory-query";
import { publicCompetitionEntryCondition, publicCompetitionEntryLabel } from "@/lib/competition-entries/public-visibility";
import { Suspense } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, users } from "@/db/schema";
import { AdminShortcutSlot } from "@/components/layout/AdminShortcutSlot";
import { PageHeader, PageLayout, Stat } from "@/components/rivalhub";
import { TeamCard } from "@/components/teams/TeamCard";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { createEmptyPublicEventTeamRecord, getPublicEventTeamMatchSummary } from "@/lib/competition-entries/public-team-context";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantSummary } from "@/lib/major/public-participants";

export default async function CompetitionEntriesPage({ params, searchParams }: { params: Promise<{ seasonSlug: string }>; searchParams?: Promise<{ q?: string }> }) {
  const { seasonSlug } = await params;
  const { q } = parseParticipantDirectoryQuery(await searchParams);
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  if (season.competitionTemplate === "major") {
    const summary = await getMajorPublicParticipantSummary(season);

    const visibleTeams = summary.teams.filter((team) => matchesDirectorySearch(q, team.entry.name, ...team.roster.map((member) => member.name)));
    const [mapPreviews, results] = await Promise.all([
      getBatchPublicTeamMapPreviews(visibleTeams.map((team) => team.entry.id)),
      getPublicSeasonResults(season),
    ]);
    return <PageLayout as="div" variant="wide" className="space-y-8">
      <PageHeader
        title={summary.presentation.teamCollectionLabel}
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visibleTeams.map((team) => (
            <TeamCard
              key={team.entry.id}
              entryId={team.entry.id}
              teamName={team.entry.name}
              seasonSlug={seasonSlug}
              eyebrow={team.cardLabel}
              logoUrl={team.entry.logoUrl}
              players={team.roster}
              record={team.record}
              maps={mapPreviews.get(team.entry.id)?.own ?? []}
              stages={mapPreviews.get(team.entry.id)?.playedStages?.map((key) => results.stageNames?.[key]).filter((name): name is string => Boolean(name))}
              placement={results.placements.find((placement) => placement.entryId === team.entry.id)?.label}
              summary={null}
            />
          ))}
        </div>
      )}
    </PageLayout>;
  }

  const entries = await db.query.competitionEntries.findMany({ where: and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition()), orderBy: [asc(competitionEntries.formationOrder), asc(competitionEntries.createdAt)] });
  if (entries.length === 0) return <PageLayout variant="wide" className="py-16 text-center text-[var(--color-fg-mid)]">赛事队伍尚未形成</PageLayout>;
  const members = await db.select({ entryId: eventRosters.entryId, userId: users.id, steamName: users.steamName, avatarUrl: users.avatarUrl, perfectName: users.perfectName, displayName: users.displayName, isStarter: eventRosterMembers.isPrimaryStarter })
    .from(eventRosterMembers).innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId)).innerJoin(users, eq(users.id, eventRosterMembers.userId)).where(and(inArray(eventRosters.entryId, entries.map((entry) => entry.id)), inArray(eventRosters.status, ["confirmed", "frozen"])));
  const matchSummary = await getPublicEventTeamMatchSummary(season.id, entries.map((entry) => entry.id));
  const membersByEntry = new Map<string, typeof members>();
  for (const member of members) membersByEntry.set(member.entryId, [...(membersByEntry.get(member.entryId) ?? []), member]);
  const record = (entryId: string) => matchSummary.records.get(entryId) ?? createEmptyPublicEventTeamRecord();
  const entryEyebrow = (formationOrder: number | null) => season.registrationMode === "team" && season.status === "registration"
    ? "已通过报名审核"
    : formationOrder !== null
      ? `选秀第 ${formationOrder} 顺位`
      : "赛事队伍";
  const visibleEntries = entries.filter((entry) => matchesDirectorySearch(q, entry.name, ...(membersByEntry.get(entry.id) ?? []).map(getPublicDisplayName)));
  const [mapPreviews, results] = await Promise.all([
    getBatchPublicTeamMapPreviews(visibleEntries.map((entry) => entry.id)),
    getPublicSeasonResults(season),
  ]);
  return <PageLayout as="div" variant="wide" className="space-y-8">
    <PageHeader title={publicCompetitionEntryLabel(season)} eyebrow={season.name} actions={<Suspense fallback={null}><AdminShortcutSlot href={`/admin/${seasonSlug}/settings`} label="赛事管理" /></Suspense>} />
    <div className="grid grid-cols-3 gap-3 sm:gap-4"><Stat label={publicCompetitionEntryLabel(season)} value={entries.length} /><Stat label="已确认选手" value={members.length} /><Stat label="比赛" value={`${matchSummary.finished}/${matchSummary.total}`} /></div>
    <p className="text-xs text-[var(--color-fg-dim)]">{season.registrationMode === "team" && season.status === "registration" ? "审核通过后进入正赛候选池，正式正赛名额由赛委会确认。" : "这里展示本届赛事队伍；队伍资料与历史请到队伍页面查看。"}</p>
    <ParticipantDirectoryToolbar query={q} total={visibleEntries.length} />
    {visibleEntries.length === 0 ? (
      <div className="py-16 text-center text-[var(--color-fg-mid)]">{q ? "没有匹配的队伍或选手" : "赛事队伍尚未形成"}</div>
    ) : (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{visibleEntries.map((entry) => <TeamCard stages={mapPreviews.get(entry.id)?.playedStages?.map((key) => results.stageNames?.[key]).filter((name): name is string => Boolean(name))} maps={mapPreviews.get(entry.id)?.own} placement={results.placements.find((placement) => placement.entryId === entry.id)?.label} key={entry.id} entryId={entry.id} teamName={entry.name} seasonSlug={seasonSlug} eyebrow={entryEyebrow(entry.formationOrder)} logoUrl={entry.logoUrl} players={(membersByEntry.get(entry.id) ?? []).map((member) => ({ name: getPublicDisplayName(member), avatarUrl: member.avatarUrl, isStarter: member.isStarter, isRepresentative: member.userId === entry.representativeUserId, userId: member.userId }))} record={record(entry.id)} summary={null} />)}</div>
    )}
  </PageLayout>;
}
