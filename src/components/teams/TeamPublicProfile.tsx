import { TeamRosterMapContext, TeamWorkspace } from "@/components/stats/teams/TeamWorkspace";
import type { PublicTeamMapProfile } from "@/lib/teams/map-profile";
import type { PublicSeasonResults } from "@/lib/seasons/public-results";
import type { LongTeamCareerDetail, TournamentTeamDetail } from "@/lib/stats/tournament-query";
import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PosChip, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { RecruitmentInterestButton } from "@/components/recruitment/RecruitmentInterestButton";
import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import { presentMatchStatus } from "@/lib/matches/presentation";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";
import type { PublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";
import { presentTeamMembershipStatus, presentTeamStatus } from "@/lib/teams/presentation";
import { formatCSTShortDate } from "@/lib/utils/date";

export interface TeamPublicProfileProps {
  team: PublicTeamProfile | null;
  mapProfile?: PublicTeamMapProfile;
  results?: PublicSeasonResults;
  event?: PublicEventTeamContext | null;
  performance?: LongTeamCareerDetail | TournamentTeamDetail | null;
  career?: PublicLongTeamProfileReadModel["career"];
}

export function TeamPublicProfile({ team, event = null, mapProfile, results, performance, career = [] }: TeamPublicProfileProps) {
  const identity = event?.entry ?? team?.team;
  if (!identity) return null;

  const currentMembers = team?.currentMembers ?? [];
  const currentUserMembership = team?.currentUserMembership ?? null;
  const membershipLabel = currentUserMembership && team
    ? `我的队伍 · ${team.team.captainUserId === currentUserMembership.userId ? "队长" : "成员"}`
    : null;
  const currentEntries = team?.entries.filter((entry) => !["finished", "archived"].includes(entry.seasonStatus)) ?? [];
  const eventPlacement = event ? results?.placements.find((entry) => entry.entryId === event.entry.id) ?? null : null;
  const eventHonors = event ? results?.honors.filter((honor) => honor.entryId === event.entry.id) ?? [] : [];
  const eventDetail = event && performance && !("linkedEntries" in performance) ? performance : null;
  const longDetail = !event && performance && "linkedEntries" in performance ? performance : null;
  const headline = event ? {
    matches: eventDetail?.results ? `${eventDetail.results.matchWins}-${eventDetail.results.matchLosses}` : `${event.record.wins}-${event.record.losses}`,
    maps: eventDetail?.results ? `${eventDetail.results.mapWins}-${eventDetail.results.mapLosses}` : "—",
    mapCount: eventDetail?.results?.maps ?? "—",
  } : {
    matches: longDetail ? `${longDetail.results.wins}-${longDetail.results.losses}` : `${team?.wins ?? 0}-${Math.max((team?.playedCount ?? 0) - (team?.wins ?? 0), 0)}`,
    maps: longDetail ? `${longDetail.results.mapWins}-${longDetail.results.mapLosses}` : "—",
    mapCount: longDetail?.results.maps ?? "—",
  };
  const hasOwnMaps = eventDetail
    ? eventDetail.maps.some((row) => (row.results?.played ?? 0) > 0)
    : longDetail
      ? longDetail.maps.some((row) => (row.results?.played ?? 0) > 0)
      : Boolean(mapProfile?.own.some((map) => map.played > 0));
  const eventRosterHeading = event && (event.season.status === "finished" || event.season.status === "archived")
    ? "本届名单"
    : event?.rosterLabel ?? "本届名单";

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
            description={event ? null : (team?.team.description ?? "暂无队伍简介。")}
            status={event ? (
              eventPlacement ? <StatusPill label={eventPlacement.label} tone="accent" /> : null
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {team && <StatusPill {...presentTeamStatus(team.team.status)} />}
                {team?.team.status === "active" && team.recruitment && <StatusPill label="招募中" tone="accent" />}
                {currentUserMembership && <StatusPill label={membershipLabel ?? "我的队伍 · 成员"} tone="accent" />}
              </div>
            )}
            actions={event ? (
              <div className="flex flex-wrap items-center gap-3">
                {team && <Link href={`/teams/${team.team.slug}`} className="text-sm text-[var(--color-accent)] hover:underline">队伍主页 · {team.team.name}</Link>}
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
            { label: "Match W-L", value: headline.matches },
            { label: "Map W-L", value: headline.maps },
            { label: "Maps", value: headline.mapCount },
            { label: "Rating", value: performance?.teamRating ? performance.teamRating.rating.toFixed(2) : "—" },
          ].map(({ label, value }, index) => (
            <div key={label} className={`px-5 py-3 ${index % 2 ? "border-l" : ""} border-[var(--color-border)] sm:border-l sm:first:border-l-0`}>
              <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-dim)]">{label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {event && <div className="grid gap-8">
        <section className="space-y-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">ROSTER</p><h2 className="mt-1 text-lg font-semibold">{eventRosterHeading}</h2></div>
          <div className="border-y border-[var(--color-border)] px-1">
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
              )) : <p className="py-4 text-sm text-[var(--color-fg-mid)]">{eventRosterHeading}暂无可展示成员。</p>}
            </div>
          </div>
        </section>

        {eventDetail && <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">PERFORMANCE</p><h2 className="mt-1 text-lg font-semibold">竞技表现</h2></div><TeamWorkspace detail={eventDetail} /></section>}
        {mapProfile && <TeamRosterMapContext mapProfile={mapProfile} hasOwnMaps={hasOwnMaps} />}

        <section className="space-y-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">MATCHES</p><h2 className="mt-1 text-lg font-semibold">本届比赛</h2></div>
          <div className="border-y border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {event.matches.length > 0 ? event.matches.map((match) => {
              const statusLabel = presentMatchStatus(match.status, { isForfeit: match.isForfeit, scheduledAt: match.scheduledAt }).label;
              const hasScore = match.ownScore !== null && match.opponentScore !== null;
              return (
                <Link key={match.id} href={`/${event.season.slug}/matches/${match.id}`} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-1 py-3 text-sm hover:bg-[var(--color-panel-hi)]">
                  <span className="min-w-0 break-words font-medium">对阵 {match.opponentName ?? "待定"}</span>
                  <span className="flex w-[5.5rem] shrink-0 flex-col items-end text-right tabular-nums">
                    {hasScore && <span className="text-base font-semibold tabular-nums">{match.ownScore} : {match.opponentScore}</span>}
                    <span className={`${hasScore ? "mt-0.5" : ""} text-xs font-normal text-[var(--color-fg-mid)]`}>{statusLabel}</span>
                  </span>
                </Link>
              );
            }) : <p className="py-4 text-sm text-[var(--color-fg-mid)]">暂无比赛。</p>}
          </div>
        </section>
      </div>}

      {!event && team && <>
        <div className="grid gap-8">
          <section className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">TEAM</p><h2 className="mt-1 text-lg font-semibold">当前成员</h2></div>
            <div className="border-y border-[var(--color-border)] px-1">
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
            </div>
            {currentEntries.length > 0 && <div className="border-t border-[var(--color-border)] pt-3"><p className="mb-2 text-xs font-medium text-[var(--color-fg-dim)]">当前赛事</p><div className="space-y-2">{currentEntries.map((entry) => <Link key={entry.id} className="flex items-center justify-between gap-3 text-sm hover:text-[var(--color-accent)]" href={`/${entry.seasonSlug}/teams/${entry.id}`}><span><span className="font-medium">{entry.seasonName}</span><span className="ml-2 text-[var(--color-fg-mid)]">{entry.name}</span></span><span>→</span></Link>)}</div></div>}
          </section>

          {longDetail && <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">PERFORMANCE</p><h2 className="mt-1 text-lg font-semibold">竞技表现</h2></div><TeamWorkspace detail={longDetail} /></section>}
          {mapProfile && <TeamRosterMapContext mapProfile={mapProfile} hasOwnMaps={hasOwnMaps} />}
          <section className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">CAREER</p><h2 className="mt-1 text-lg font-semibold">赛事履历</h2></div>
            <div className="border-y border-[var(--color-border)]">
            {career.length > 0 ? (
              <div className="divide-y divide-[var(--color-border)]">
                {career.map((entry) => (
                  <Link key={entry.id} href={`/${entry.seasonSlug}/teams/${entry.id}`} className="grid gap-3 px-5 py-4 hover:bg-[var(--color-panel-hi)] sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold">{entry.seasonName}</span>
                      <span className="mt-1 block break-words text-xs text-[var(--color-fg-mid)]">{entry.name}</span>
                      {entry.honors.length > 0 && <span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs font-medium text-[var(--color-accent)]">{entry.honors.map((honor) => <span key={honor}>{honor}</span>)}</span>}
                    </span>
                    <span className="grid grid-cols-3 gap-3 text-xs tabular-nums text-[var(--color-fg-mid)]">
                      <span><span className="block text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">Match</span><span className="mt-0.5 block font-medium text-[var(--color-fg)]">{entry.matchWins}-{entry.matchLosses}</span></span>
                      <span><span className="block text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">Map</span><span className="mt-0.5 block font-medium text-[var(--color-fg)]">{entry.mapWins}-{entry.mapLosses}</span></span>
                      <span><span className="block text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">Maps</span><span className="mt-0.5 block font-medium text-[var(--color-fg)]">{entry.maps}</span></span>
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="text-xs font-medium text-[var(--color-fg-mid)]">{entry.placement ?? "完赛"}</span>
                      <span aria-hidden>→</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : <div className="p-5"><EmptyState title="尚无已结束赛事记录。" /></div>}
            </div>
          </section>
        </div>
      </>}

      {!event && team && <section className="space-y-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">PROFILE</p><h2 className="mt-1 text-lg font-semibold">队伍资料</h2></div>
        {team.recruitment && <Panel label="正在招募" contentClassName="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--color-fg-mid)]">需要位置</span>{team.recruitment.positions.length ? team.recruitment.positions.map((position) => <PosChip key={position} pos={position} />) : <span className="text-sm">位置不限</span>}</div>{team.recruitment.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {team.recruitment.targetSeasonName}</p>}{team.recruitment.note && <p className="max-w-2xl text-sm leading-6 text-[var(--color-fg-mid)]">{team.recruitment.note}</p>}<p className="text-xs text-[var(--color-fg-dim)]">更新于 {formatCSTShortDate(team.recruitment.updatedAt)}</p></div>{!currentUserMembership && <RecruitmentInterestButton recruitmentIntentId={team.recruitment.id} interested={team.viewerInterested} invited={team.viewerInvited} loggedIn={team.loggedIn} />}
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
      </section>}
    </div>
  );
}
