import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PosChip, Stat, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { RecruitmentInterestButton } from "@/components/recruitment/RecruitmentInterestButton";
import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import {
  presentCompetitionEntryRegistration,
  presentCompetitionEntryRosterStatus,
} from "@/lib/competition-entries/presentation";
import { presentMatchStatus } from "@/lib/matches/presentation";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";
import { presentTeamMembershipStatus, presentTeamStatus } from "@/lib/teams/presentation";
import { formatCSTShortDate } from "@/lib/utils/date";

export interface TeamPublicProfileProps {
  team: PublicTeamProfile | null;
  event?: PublicEventTeamContext | null;
}

export function TeamPublicProfile({ team, event = null }: TeamPublicProfileProps) {
  const identity = event?.entry ?? team?.team;
  if (!identity) return null;

  const currentMembers = team?.currentMembers ?? [];
  const currentUserMembership = team?.currentUserMembership ?? null;
  const membershipLabel = currentUserMembership && team
    ? `我的队伍 · ${team.team.captainUserId === currentUserMembership.userId ? "队长" : "成员"}`
    : null;
  const participation = event?.participation ?? null;
  const rosterStatus = event ? presentCompetitionEntryRosterStatus(event.rosterStatus) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={(
          <span className="flex items-center gap-4">
            <TeamLogo logoUrl={identity.logoUrl} teamName={identity.name} size="lg" />
            <span>{identity.name}</span>
          </span>
        )}
        eyebrow={event ? `${event.season.name} · ${event.roster.length} 名参赛成员` : `${currentMembers.length} 名当前成员`}
        description={event
          ? `${participation?.detail ?? "本页展示本届赛事事实。"} 本页队名、图标、名单和赛果按本届赛事记录展示。${team ? " 下方另列长期队伍资料。" : ""}`
          : (team?.team.description ?? "暂无队伍简介。")}
        status={(
          <div className="flex flex-wrap items-center gap-1.5">
            {team && <StatusPill {...presentTeamStatus(team.team.status)} />}
            {team?.team.status === "active" && team.recruitment && <StatusPill label="招募中" tone="accent" />}
            {participation && <StatusPill {...participation} />}
            {event?.seedPresentation && <StatusPill {...event.seedPresentation} />}
            {currentUserMembership && <StatusPill label={membershipLabel ?? "我的队伍 · 成员"} tone="accent" />}
          </div>
        )}
        actions={(event || (team && currentUserMembership && team.team.status === "active")) && (
          <div className="flex flex-wrap items-center gap-2">
            {event && team && <Button size="sm" variant="outline" asChild><Link href={`/teams/${team.team.slug}`}>长期队伍资料</Link></Button>}
            {event && <Link href={`/${event.season.slug}/teams`} className="text-sm text-[var(--color-fg-secondary)] hover:text-[var(--color-fg-primary)]">返回赛事队伍</Link>}
            {team && currentUserMembership && team.team.status === "active" && <Button size="sm" asChild><Link href="/my/teams">管理我的队伍</Link></Button>}
          </div>
        )}
      />

      {event && <>
        <Panel label={`${event.season.name} · 本届赛事`} contentClassName="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {participation && <StatusPill {...participation} />}
              {rosterStatus && <StatusPill {...rosterStatus} />}
              {event.seedPresentation && <StatusPill {...event.seedPresentation} />}
            </div>
            <p className="text-sm text-[var(--color-fg-mid)]">{participation?.detail}</p>
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="本届比赛" value={event.record.played} />
          <Stat label="本届胜场" value={event.record.wins} accent />
          <Stat label="本届负场" value={event.record.losses} />
          <Stat label="本届名单" value={event.roster.length} />
        </div>

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
                  {member.isRepresentative && <PosChip pos="R" small />}
                </div>
                <span className="text-xs text-[var(--color-fg-mid)]">{member.isStarter ? "首发" : "替补"}</span>
              </div>
            )) : <p className="text-sm text-[var(--color-fg-mid)]">{event.rosterLabel}暂无可展示成员。</p>}
          </div>
        </Panel>

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

      {event && team && <Panel label="长期队伍资料" contentClassName="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <TeamLogo logoUrl={team.team.logoUrl} teamName={team.team.name} />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/teams/${team.team.slug}`} className="font-semibold hover:text-[var(--color-accent)]">{team.team.name}</Link>
                <StatusPill {...presentTeamStatus(team.team.status)} />
              </div>
              <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{team.team.description ?? "暂无队伍简介。"}</p>
            </div>
          </div>
          <Link href={`/teams/${team.team.slug}`} className="shrink-0 text-sm text-[var(--color-accent)] hover:underline">查看完整长期资料</Link>
        </div>
      </Panel>}

      {team?.recruitment && <Panel label="正在招募" contentClassName="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--color-fg-mid)]">需要位置</span>{team.recruitment.positions.length ? team.recruitment.positions.map((position) => <PosChip key={position} pos={position} />) : <span className="text-sm">位置不限</span>}</div>{team.recruitment.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {team.recruitment.targetSeasonName}</p>}{team.recruitment.note && <p className="max-w-2xl text-sm leading-6 text-[var(--color-fg-mid)]">{team.recruitment.note}</p>}<p className="text-xs text-[var(--color-fg-dim)]">更新于 {formatCSTShortDate(team.recruitment.updatedAt)}</p></div>{!currentUserMembership && <RecruitmentInterestButton recruitmentIntentId={team.recruitment.id} interested={team.viewerInterested} loggedIn={team.loggedIn} />}
        </div>
      </Panel>}

      {team && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="当前成员" value={currentMembers.length} />
          <Stat label="赛事记录" value={team.entries.length} />
          <Stat label="比赛场次" value={team.playedCount} />
          <Stat label="获胜场次" value={team.wins} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
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

          <Panel label="赛事履历" contentClassName="p-5">
            <div className="divide-y divide-[var(--color-border)]">
              {team.entries.length > 0 ? team.entries.map((entry) => (
                <Link key={entry.id} href={`/${entry.seasonSlug}/teams/${entry.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-[var(--color-panel-hi)]">
                  <span className="flex min-w-0 flex-col gap-1 text-sm"><span className="break-words font-medium">{entry.seasonName}</span><span className="break-words text-xs text-[var(--color-fg-mid)]">{entry.name}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><StatusPill {...presentCompetitionEntryRegistration(entry.status)} /><span className="text-xs text-[var(--color-fg-dim)]">{formatCSTShortDate(entry.createdAt)}</span></span>
                </Link>
              )) : <EmptyState title="尚无赛事记录。" />}
            </div>
          </Panel>
        </div>

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
