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

function HistorySection({ history, excludeTeamId }: { history: MyTeamHistory[]; excludeTeamId?: string }) {
  const entries = excludeTeamId ? history.filter((row) => row.teamId !== excludeTeamId || row.endedAt !== null) : history;
  if (entries.length === 0) return null;
  return <Section><SectionHeader title="成员历史" description="长期队伍成员关系按加入时间记录；赛事名单不会随之改写。" /><Panel contentClassName="p-5"><div className="space-y-2">{entries.map((row) => <Link key={row.id} href={`/teams/${row.teamSlug}`} className="flex flex-wrap justify-between gap-2 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0"><span>{row.teamName} · {row.role === "captain" ? "队长" : "成员"}</span><span className="text-[var(--color-fg-mid)]">{formatCSTShortDate(row.startedAt)} — {row.endedAt ? formatCSTShortDate(row.endedAt) : "至今"}</span></Link>)}</div></Panel></Section>;
}

function CompetitionSection({ contexts, title, description }: { contexts: MyCompetitionContext[]; title: string; description: string }) {
  return <Section><SectionHeader title={title} description={description} />{contexts.length > 0 ? <div className="grid gap-4 xl:grid-cols-2">{contexts.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div> : <EmptyState title="暂无相关赛事" sub="长期队伍关系与赛事报名、名单事实分别维护。" />}</Section>;
}

export function MyTeamWorkspace({ model }: { model: MyTeamWorkspaceModel }) {
  if (model.kind === "none") {
    return <div className="space-y-8"><PageHeader title="我的队伍" description="处理队伍邀请，或开始组建长期队伍。" /><NoTeamWorkspace pendingInvitations={model.pendingInvitations} /><HistorySection history={model.history} /></div>;
  }

  const grouped = groupMyCompetitionContexts(model.competitions);
  const roleDescription = model.kind === "captain"
    ? "先处理当前赛事与招募意向，再维护队伍资料、成员和邀请。"
    : "查看你与长期队伍的关系、相关赛事和本人可执行的操作。";
  return <div className="space-y-8">
    <PageHeader title="我的队伍" description={roleDescription} />
    <MyTeamIdentity team={model.team} />
    {model.kind === "captain" && model.recruitmentInterests.length > 0 && <Panel label="需要处理" contentClassName="p-5"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">有 {model.recruitmentInterests.length} 名选手表达了加入队伍的意向。</p><Link className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline" href="#recruitment-interests">查看并处理加入意向 →</Link></Panel>}
    <CompetitionSection contexts={grouped.current} title="当前赛事" description="本届赛事的报名状态、参赛确认和比赛事实分别展示。" />
    {model.kind === "member" ? <><TeamMemberList members={model.members} /><Panel label="成员关系" contentClassName="p-5"><LeaveTeamControl teamId={model.team.id} /></Panel></> : <LongLivedTeamWorkspace team={model.team} memberships={model.members} incomingInvitations={model.incomingInvitations} outgoingInvitations={model.outgoingInvitations} recruitment={model.recruitment} targetSeasons={model.targetSeasons} recruitmentInterests={model.recruitmentInterests} />}
    <CompetitionSection contexts={grouped.history} title="赛事历史" description="已结束和已归档赛事按赛季时间倒序展示，不把队伍成员历史当作赛事名单。" />
    <HistorySection history={model.history} excludeTeamId={model.team.id} />
  </div>;
}
