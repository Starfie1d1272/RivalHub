import { TeamMapProfile } from "@/components/teams/TeamMapProfile";
import type { PublicTeamMapProfile } from "@/lib/teams/map-profile";
import type { PublicSeasonResults } from "@/lib/seasons/public-results";
import type { LongTeamCareerDetail, TournamentTeamDetail } from "@/lib/stats/tournament-query";
import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PosChip, Stat, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { RecruitmentInterestButton } from "@/components/recruitment/RecruitmentInterestButton";
import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import {
  presentCompetitionEntryRosterStatus,
} from "@/lib/competition-entries/presentation";
import { presentMatchStatus } from "@/lib/matches/presentation";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";
import { presentTeamMembershipStatus, presentTeamStatus } from "@/lib/teams/presentation";
import { formatCSTShortDate } from "@/lib/utils/date";

export interface TeamPublicProfileProps {
  team: PublicTeamProfile | null;
  mapProfile?: PublicTeamMapProfile;
  results?: PublicSeasonResults;
  stageLabels?: Readonly<Record<string, string>>;
  event?: PublicEventTeamContext | null;
  performance?: LongTeamCareerDetail | TournamentTeamDetail | null;
}

export function TeamPublicProfile({ team, event = null, mapProfile, results, stageLabels = {}, performance }: TeamPublicProfileProps) {
  const identity = event?.entry ?? team?.team;
  if (!identity) return null;

  const currentMembers = team?.currentMembers ?? [];
  const currentUserMembership = team?.currentUserMembership ?? null;
  const membershipLabel = currentUserMembership && team
    ? `我的队伍 · ${team.team.captainUserId === currentUserMembership.userId ? "队长" : "成员"}`
    : null;
  const participation = event?.participation ?? null;
  const nextMatch = event?.matches.filter((match) => match.status === "scheduled" || match.status === "in_progress").sort((a, b) => (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity))[0];
  const rosterStatus = event ? presentCompetitionEntryRosterStatus(event.rosterStatus) : null;
  const currentEntries = team?.entries.filter((entry) => !["finished", "archived"].includes(entry.seasonStatus)) ?? [];
  const historicalEntries = team?.entries.filter((entry) => ["finished", "archived"].includes(entry.seasonStatus)) ?? [];
  const eventPlacement = event ? results?.placements.find((entry) => entry.entryId === event.entry.id) ?? null : null;
  const eventHonors = event ? results?.honors.filter((honor) => honor.entryId === event.entry.id) ?? [] : [];
  const eventDetail = event && performance && "teamId" in performance ? performance : null;
  const longDetail = !event && performance && "linkedEntries" in performance ? performance : null;
  const headline = event ? {
    matches: eventDetail?.results ? `${eventDetail.results.matchWins}-${eventDetail.results.matchLosses}` : `${event.record.wins}-${event.record.losses}`,
    maps: eventDetail?.results ? `${eventDetail.results.mapWins}-${eventDetail.results.mapLosses}` : "—",
    mapCount: eventDetail?.results?.maps ?? "—",
    rating: eventDetail?.performance?.slices.overall.rating ?? null,
  } : {
    matches: longDetail ? `${longDetail.results.wins}-${longDetail.results.losses}` : `${team?.wins ?? 0}-${Math.max((team?.playedCount ?? 0) - (team?.wins ?? 0), 0)}`,
    maps: longDetail ? `${longDetail.results.mapWins}-${longDetail.results.mapLosses}` : "—",
    mapCount: longDetail?.results.maps ?? "—",
    rating: longDetail?.performance?.slices.overall.rating ?? null,
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden border border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="p-5 sm:p-6">
          <PageHeader
            title={(
              <span className="flex items-center gap-4">
                <TeamLogo logoUrl={identity.logoUrl} teamName={identity.name} size="lg" />
                <span>{identity.name}</span>
              </span>
            )}
            eyebrow={event ? event.season.name : "Team"}
            description={event ? (participation?.detail ?? null) : (team?.team.description ?? "暂无队伍简介。")}
            status={(
              <div className="flex flex-wrap items-center gap-1.5">
                {event ? <>
                  {participation && <StatusPill {...participation} />}
                  {rosterStatus && <StatusPill {...rosterStatus} />}
                  {event.seedPresentation && <StatusPill {...event.seedPresentation} />}
                  {eventPlacement && <StatusPill label={eventPlacement.label} tone="accent" />}
                </> : <>
                  {team && <StatusPill {...presentTeamStatus(team.team.status)} />}
                  {team?.team.status === "active" && team.recruitment && <StatusPill label="招募中" tone="accent" />}
                  {currentUserMembership && <StatusPill label={membershipLabel ?? "我的队伍 · 成员"} tone="accent" />}
                </>}
              </div>
            )}
            actions={event ? (
              <div className="flex flex-wrap items-center gap-3">
                {team && <Link href={`/teams/${team.team.slug}`} className="text-sm text-[var(--color-accent)] hover:underline">长期队伍 · {team.team.name}</Link>}
                <Link href={`/${event.season.slug}/teams`} className="text-sm text-[var(--color-fg-secondary)] hover:text-[var(--color-fg-primary)]">返回赛事队伍</Link>
              </div>
            ) : (team && currentUserMembership && team.team.status === "active") ? (
              <Button size="sm" asChild><Link href="/my/teams">管理我的队伍</Link></Button>
            ) : null}
          />
          {eventHonors.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{eventHonors.map((honor) => <span key={honor.id} className="text-sm font-semibold text-[var(--color-accent)]">{honor.label}</span>)}</div>}
        </div>
        <div className="grid grid-cols-2 border-t border-[var(--color-border)] sm:grid-cols-4">
          {[
            ["Match W-L", headline.matches],
            ["Map W-L", headline.maps],
            ["Maps", headline.mapCount],
            ["Team Rating", headline.rating == null ? "—" : headline.rating.toFixed(2)],
          ].map(([label, value], index) => (
            <div key={label} className={`px-5 py-3 ${index % 2 ? "border-l" : ""} border-[var(--color-border)] sm:border-l sm:first:border-l-0`}>
              <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-dim)]">{label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {event && <>

        <Panel label={event.rosterLabel} contentClassName="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-mid)]">
            {rosterStatus && <StatusPill {...rosterStatus} />}
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {event.roster.length > 0 ? event.roster.map((member) => (
              <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <PlayerAvatar name={member.name} avatarUrl={member.avatarUrl} size="sm" />
                  {member.isStarter && <PosChip pos="S" small />}
                  <Link href={`/players/${member.userId}`} className="min-w-0 break-words font-medium hover:text-[var(--color-accent)]">{member.name}</Link>
                </div>
                <span className="text-xs text-[var(--color-fg-mid)]">{member.isStarter ? "首发" : "替补"}</span>
              </div>
            )) : <p className="text-sm text-[var(--color-fg-mid)]">{event.rosterLabel}暂无可展示成员。</p>}
          </div>
        </Panel>

        {event && <Panel label="Event Summary" contentClassName="p-5"><div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-[var(--color-fg-dim)]">Record</p><p className="mt-1 font-semibold tabular-nums">{event.record.wins}-{event.record.losses}</p></div><div><p className="text-xs text-[var(--color-fg-dim)]">Roster</p><p className="mt-1 font-semibold">{event.roster.length} 名</p></div><div><p className="text-xs text-[var(--color-fg-dim)]">Seed</p><p className="mt-1 font-semibold">{event.seedPresentation?.label ?? "待确认"}</p></div></div>{nextMatch && <Link className="mt-4 block border-t border-[var(--color-border)] pt-4 text-sm font-semibold hover:text-[var(--color-accent)]" href={`/${event.season.slug}/matches/${nextMatch.id}`}>下一场 · {nextMatch.opponentName ?? "待定"} →</Link>}</Panel>}
        {mapProfile && <TeamMapProfile profile={mapProfile} event />} className="font-semibold text-[var(--color-accent)]">{honor.label}</p>)}
        <Panel label="本届比赛" contentClassName="p-5">
          <div className="space-y-2">
            {event.matches.length > 0 ? event.matches.map((match) => (
              <Link key={match.id} href={`/${event.season.slug}/matches/${match.id}`} className="flex flex-wrap justify-between gap-2 border border-[var(--color-border)] p-3 text-sm hover:bg-[var(--color-panel-hi)]">
                <span>对阵 {match.opponentName ?? "待定"}</span>
                <span>{presentMatchStatus(match.status, { isForfeit: match.isForfeit, scheduledAt: match.scheduledAt }).label}{match.ownScore !== null && match.opponentScore !== null ? ` · ${match.ownScore}:${match.opponentScore}` : ""}</span>
              </Link>
            )) : <p className="text-sm text-[var(--color-fg-mid)]">暂无比赛。</p>}
          </div>
        </Panel>
      </>}

      {!event && team && <>
        {currentEntries.length > 0 && <Panel label="Current Event" contentClassName="p-5"><div className="space-y-2">{currentEntries.map((entry) => <Link key={entry.id} className="flex items-center justify-between gap-3 text-sm hover:text-[var(--color-accent)]" href={`/${entry.seasonSlug}/teams/${entry.id}`}><span><span className="font-medium">{entry.seasonName}</span><span className="ml-2 text-[var(--color-fg-mid)]">{entry.name}</span></span><span>→</span></Link>)}</div></Panel>}

        <div className="grid gap-5">
          <Panel label="当前成员" contentClassName="p-5">
            <div className="divide-y divide-[var(--color-border)]">
              {currentMembers.length > 0 ? currentMembers.map((member) => (
                <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <PlayerAvatar name={member.name} avatarUrl={member.avatarUrl} size="sm" />
                    {member.userId === team.team.captainUserId && <PosChip pos="C" small />}
                    <Link href={`/players/${member.userId}`} className="min-w-0 break-words text-sm hover:text-[var(--color-accent)]">{member.name}</Link>
                  </div>
                  <StatusPill {...presentTeamMembershipStatus(member.status)} />
                </div>
              )) : <EmptyState title="暂无当前成员" />}
            </div>
          </Panel>

          {mapProfile && <TeamMapProfile profile={mapProfile} />}
          <Panel label="赛事履历" contentClassName="p-5">
            <div className="divide-y divide-[var(--color-border)]">
              {historicalEntries.length > 0 ? historicalEntries.map((entry) => (
                <Link key={entry.id} href={`/${entry.seasonSlug}/teams/${entry.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-[var(--color-panel-hi)]">
                  <span className="flex min-w-0 flex-col gap-1 text-sm"><span className="break-words font-medium">{entry.seasonName}</span><span className="break-words text-xs text-[var(--color-fg-mid)]">{entry.name}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill label="完赛" tone="neutral" />
                  </span>
                </Link>
              )) : <EmptyState title="尚无已结束赛事记录。" />}
            </div>
          </Panel>
        </div>

      {!event && team?.recruitment && <Panel label="正在招募" contentClassName="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--color-fg-mid)]">需要位置</span>{team.recruitment.positions.length ? team.recruitment.positions.map((position) => <PosChip key={position} pos={position} />) : <span className="text-sm">位置不限</span>}</div>{team.recruitment.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {team.recruitment.targetSeasonName}</p>}{team.recruitment.note && <p className="max-w-2xl text-sm leading-6 text-[var(--color-fg-mid)]">{team.recruitment.note}</p>}<p className="text-xs text-[var(--color-fg-dim)]">更新于 {formatCSTShortDate(team.recruitment.updatedAt)}</p></div>{!currentUserMembership && <RecruitmentInterestButton recruitmentIntentId={team.recruitment.id} interested={team.viewerInterested} loggedIn={team.loggedIn} />}
        </div>
      </Panel>}

        <Panel label="队伍历史" contentClassName="p-5">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="font-semibold">名称变更</h3>
              {team.nameChanges.length > 0 ? <div className="space-y-2">{team.nameChanges.map((change) => <p key={change.id} className="text-sm text-[var(--color-fg-mid)]">{change.oldName ? `${change.oldName} → ` : ""}{change.newName} · {formatCSTShortDate(change.changedAt)}</p>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无变更记录</p>}
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">队长变更</h3>
              {team.captainChanges.length > 0 ? <div className="space-y-2">{team.captainChanges.map((change) => <p key={change.id} className="text-sm text-[var(--color-fg-mid)]">{change.name} · {formatCSTShortDate(change.changedAt)}</p>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无变更记录</p>}
            </div>
          </div>
        </Panel>
      </>}
    </div>
  );
}
