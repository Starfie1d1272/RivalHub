import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React from "react";
import Link from "next/link";
import { LongLivedTeamWorkspace } from "@/components/teams/LongLivedTeamWorkspace";
import { LeaveTeamControl } from "@/components/my/LeaveTeamControl";
import { MyCompetitionCard } from "@/components/my/MyCompetitionCard";
import { MyTeamIdentity } from "@/components/my/MyTeamIdentity";
import { NoTeamWorkspace } from "@/components/my/NoTeamWorkspace";
import { TeamMemberList } from "@/components/my/TeamMemberList";
import { EmptyState, PageHeader, Panel, Section, SectionHeader } from "@/components/rivalhub";
import { groupMyCompetitionContexts, type MyCompetitionContext } from "@/lib/my/competitions";
import type { MyTeamHistory, MyTeamWorkspaceModel } from "@/lib/my/team-workspace";
import { formatCSTShortDate } from "@/lib/utils/date";

const HISTORY_STATUS_LABELS: Record<MyTeamHistory["status"], string> = {
  active: "在队",
  benched: "替补",
  left: "已离队",
};

function HistorySection({ history, excludeTeamId }: { history: MyTeamHistory[]; excludeTeamId?: string }) {
  const entries = excludeTeamId ? history.filter((row) => row.teamId !== excludeTeamId || row.endedAt !== null) : history;
  if (entries.length === 0) return null;
  return <Section><SectionHeader title="成员历史" /><Panel contentClassName="p-5"><div className="space-y-2">{entries.map((row) => <TeamProfileLink key={row.id} slug={row.teamSlug} className="flex flex-wrap justify-between gap-2 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0"><span>{row.teamName} · {HISTORY_STATUS_LABELS[row.status]}</span><span className="text-[var(--color-fg-mid)]">{formatCSTShortDate(row.startedAt)} — {row.endedAt ? formatCSTShortDate(row.endedAt) : "至今"}</span></TeamProfileLink>)}</div></Panel></Section>;
}

function CompetitionSection({ contexts, title }: { contexts: MyCompetitionContext[]; title: string }) {
  return <Section><SectionHeader title={title} />{contexts.length > 0 ? <div className={contexts.length > 1 ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>{contexts.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div> : <EmptyState title="暂无相关赛事" />}</Section>;
}

export function MyTeamWorkspace({ model, personalCompetitions = [] }: { model: MyTeamWorkspaceModel; personalCompetitions?: MyCompetitionContext[] }) {
  const otherTeamCommitments = personalCompetitions.filter(context => context.participation?.state === "ready" && context.season.status === "registration" && (model.kind === "none" || context.teamId !== model.team.id));
  const participationTasks = otherTeamCommitments.map(context => <Panel key={context.entryId} label={context.season.name} contentClassName="p-4"><p className="text-sm leading-6">你仍确认代表{context.entryName}参加本届赛事。{model.kind !== "none" ? `加入${model.team.name}后，还需处理本届参赛队伍。` : "如需更换参赛队伍，请继续处理本届参赛确认。"}</p><Link className="mt-3 inline-block text-sm underline underline-offset-4" href={`/${context.season.slug}/register`}>处理本届参赛队伍 →</Link></Panel>);

  if (model.kind === "none") {
    return <div className="space-y-8"><PageHeader title="我的队伍" description="处理队伍邀请，或开始组建队伍。" />{participationTasks}<NoTeamWorkspace pendingInvitations={model.pendingInvitations} /><HistorySection history={model.history} /></div>;
  }

  const grouped = groupMyCompetitionContexts(model.competitions);
  return <div className="space-y-8">
    <PageHeader title="我的队伍" />
    <MyTeamIdentity team={model.team} />
    {participationTasks}
    {model.kind === "captain" && model.recruitmentInterests.length > 0 && <Panel label="需要处理" contentClassName="p-5"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">有 {model.recruitmentInterests.length} 名选手表达了加入队伍的意向。</p><Link className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline" href="#recruitment-interests">查看并处理加入意向 →</Link></Panel>}
    <CompetitionSection contexts={grouped.current} title="当前赛事" />
    {model.kind === "member" ? <><TeamMemberList members={model.members} /><Panel label="成员关系" contentClassName="p-5"><LeaveTeamControl teamId={model.team.id} /></Panel></> : <LongLivedTeamWorkspace team={model.team} memberships={model.members} incomingInvitations={model.incomingInvitations} outgoingInvitations={model.outgoingInvitations} recruitment={model.recruitment} targetSeasons={model.targetSeasons} recruitmentInterests={model.recruitmentInterests} />}
    <CompetitionSection contexts={grouped.history} title="赛事历史" />
    <HistorySection history={model.history} excludeTeamId={model.team.id} />
  </div>;
}
