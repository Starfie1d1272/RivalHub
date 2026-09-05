import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PosChip, Stat, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { RecruitmentInterestButton } from "@/components/recruitment/RecruitmentInterestButton";
import type { PublicRecruitmentIntent } from "@/lib/recruitment/data";
import { presentCompetitionEntryRegistration, type CompetitionEntryRegistrationStatus } from "@/lib/competition-entries/presentation";
import { presentTeamMembershipStatus, presentTeamStatus } from "@/lib/teams/presentation";
import { formatCSTShortDate } from "@/lib/utils/date";

type TeamStatus = "active" | "disbanded";
type MembershipStatus = "active" | "benched" | "left";

export interface TeamPublicProfileProps {
  team: {
    name: string;
    logoUrl: string | null;
    description: string | null;
    status: TeamStatus;
    captainUserId: string;
  };
  currentMembers: Array<{ id: string; userId: string; name: string; status: MembershipStatus }>;
  entries: Array<{ id: string; name: string; status: CompetitionEntryRegistrationStatus; seasonName: string; seasonSlug: string; createdAt: Date }>;
  nameChanges: Array<{ id: string; oldName: string | null; newName: string; changedAt: Date }>;
  captainChanges: Array<{ id: string; name: string; changedAt: Date }>;
  playedCount: number;
  wins: number;
  currentUserMembership: { userId: string; status: MembershipStatus } | null;
  recruitment: PublicRecruitmentIntent | null;
  viewerInterested: boolean;
  loggedIn: boolean;
}

export function TeamPublicProfile({ team, currentMembers, entries, nameChanges, captainChanges, playedCount, wins, currentUserMembership, recruitment, viewerInterested, loggedIn }: TeamPublicProfileProps) {
  const membershipLabel = currentUserMembership
    ? `我的队伍 · ${team.captainUserId === currentUserMembership.userId ? "队长" : "成员"}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={(
          <span className="flex items-center gap-4">
            <TeamLogo logoUrl={team.logoUrl} teamName={team.name} size="lg" />
            <span>{team.name}</span>
          </span>
        )}
        eyebrow={`${currentMembers.length} 名当前成员`}
        description={team.description ?? "暂无队伍简介。"}
        status={(
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill {...presentTeamStatus(team.status)} />
            {team.status === "active" && recruitment && <StatusPill label="招募中" tone="accent" />}
            {currentUserMembership && <StatusPill label={membershipLabel ?? "我的队伍 · 成员"} tone="accent" />}
          </div>
        )}
        actions={currentUserMembership && team.status === "active" ? <Button asChild><Link href="/my/teams">管理我的队伍</Link></Button> : undefined}
      />

      {recruitment && <Panel label="正在招募" contentClassName="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--color-fg-mid)]">需要位置</span>{recruitment.positions.length ? recruitment.positions.map((position) => <PosChip key={position} pos={position} />) : <span className="text-sm">位置不限</span>}</div>{recruitment.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {recruitment.targetSeasonName}</p>}{recruitment.note && <p className="max-w-2xl text-sm leading-6 text-[var(--color-fg-mid)]">{recruitment.note}</p>}<p className="text-xs text-[var(--color-fg-dim)]">更新于 {formatCSTShortDate(recruitment.updatedAt)}</p></div>{!currentUserMembership && <RecruitmentInterestButton recruitmentIntentId={recruitment.id} interested={viewerInterested} loggedIn={loggedIn} />}
        </div>
      </Panel>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="当前成员" value={currentMembers.length} />
        <Stat label="赛事记录" value={entries.length} />
        <Stat label="比赛场次" value={playedCount} />
        <Stat label="获胜场次" value={wins} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel label="当前成员" contentClassName="p-5">
          <div className="divide-y divide-[var(--color-border)]">
            {currentMembers.length > 0 ? currentMembers.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  {member.userId === team.captainUserId && <PosChip pos="C" small />}
                  <Link href={`/players/${member.userId}`} className="min-w-0 break-words text-sm hover:text-[var(--color-accent)]">{member.name}</Link>
                </div>
                <StatusPill {...presentTeamMembershipStatus(member.status)} />
              </div>
            )) : <EmptyState title="暂无当前成员" />}
          </div>
        </Panel>

        <Panel label="赛事履历" contentClassName="p-5">
          <div className="divide-y divide-[var(--color-border)]">
            {entries.length > 0 ? entries.map((entry) => (
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
            {nameChanges.length > 0 ? <div className="space-y-2">{nameChanges.map((change) => <p key={change.id} className="text-sm text-[var(--color-fg-mid)]">{change.oldName ? `${change.oldName} → ` : ""}{change.newName} · {formatCSTShortDate(change.changedAt)}</p>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无变更记录</p>}
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold">队长变更</h3>
            {captainChanges.length > 0 ? <div className="space-y-2">{captainChanges.map((change) => <p key={change.id} className="text-sm text-[var(--color-fg-mid)]">{change.name} · {formatCSTShortDate(change.changedAt)}</p>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无变更记录</p>}
          </div>
        </div>
      </Panel>
    </div>
  );
}
