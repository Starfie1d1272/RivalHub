import React from "react";
import Link from "next/link";
import { MyCompetitionCard } from "@/components/my/MyCompetitionCard";
import { PageHeader, Panel, Section, SectionHeader, StatusBanner, StatusPill } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import {
  SANCTION_EFFECT_LABELS,
  presentMyReadinessResponsibility,
  type MyReadinessItem,
  type MyReadinessModel,
  type MyReadinessState,
} from "@/lib/my/readiness";
import type { MyWorkspaceModel } from "@/lib/my/workspace";
import { formatCST } from "@/lib/utils/date";

const STATE: Record<MyReadinessState, { label: string; tone: "success" | "warn" | "danger" | "info" }> = {
  ready: { label: "已准备", tone: "success" },
  incomplete: { label: "待完善", tone: "warn" },
  waiting: { label: "等待处理", tone: "info" },
  blocked: { label: "当前受阻", tone: "danger" },
  unknown: { label: "暂时无法确认", tone: "warn" },
  not_applicable: { label: "不适用", tone: "info" },
};

type TaskAction = { item: MyReadinessItem; context: string };

function ReadinessCard({ item, context, relatedTasks }: { item: MyReadinessItem; context?: string; relatedTasks?: TaskAction[] }) {
  const state = STATE[item.state];
  const responsibility = item.responsibility;
  return (
    <div className="space-y-3 border border-[var(--color-border)] p-4">
      {context && <p className="text-xs text-[var(--color-fg-mid)]">{context}</p>}
      <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><StatusPill label={state.label} tone={state.tone} /></div>
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{item.detail}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {responsibility && <span className="text-xs text-[var(--color-fg-dim)]">{presentMyReadinessResponsibility(responsibility)}</span>}
        <div className="flex flex-wrap gap-2">{relatedTasks ? relatedTasks.map(task => <Button key={task.item.id} size="sm" variant="outline" asChild><Link href={task.item.cta.href as never} aria-label={task.context ? `${task.context} · ${task.item.cta.label}` : task.item.cta.label}>{task.context || task.item.cta.label} →</Link></Button>) : <><Button size="sm" variant={item.secondaryCta ? "default" : "outline"} asChild><Link href={item.cta.href as never}>{item.cta.label}</Link></Button>{item.secondaryCta && <Button size="sm" variant="outline" asChild><Link href={item.secondaryCta.href as never}>{item.secondaryCta.label}</Link></Button>}</>}</div>
      </div>
    </div>
  );
}

function CompetitiveCard({ profile }: { profile: MyReadinessModel["competitiveProfiles"][number] }) {
  const state = STATE[profile.state];
  return <div className="space-y-3 border border-[var(--color-border)] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{profile.displayName} 竞技档案</h3><StatusPill label={state.label} tone={state.tone} /></div><p className="text-sm leading-6 text-[var(--color-fg-mid)]">{profile.blockers.length === 0 ? "竞技资料已齐全。" : profile.blockers.join(" ")}</p><Button size="sm" variant="outline" asChild><Link href="/settings/competitive">维护竞技档案</Link></Button></div>;
}

function TeamSummary({ model }: { model: MyWorkspaceModel }) {
  if (!model.currentTeam) return <ReadinessCard item={model.readiness.team} />;
  const team = model.currentTeam;
  return <Panel label="当前队伍" contentClassName="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><TeamLogo logoUrl={team.logoUrl} teamName={team.name} size="lg" /><div className="min-w-0 flex-1 space-y-2"><div><h3 className="text-lg font-semibold"><TeamProfileLink slug={team.slug}>{team.name}</TeamProfileLink></h3><p className="text-sm text-[var(--color-fg-mid)]">你是{team.viewerRole === "captain" ? "队长" : "成员"}。</p></div><Button size="sm" variant="outline" asChild><Link href="/my/teams">{team.viewerRole === "captain" ? "管理我的队伍" : "查看我的队伍"}</Link></Button></div></div></Panel>;
}

function SanctionCard({ sanction }: { sanction: MyWorkspaceModel["sanctions"][number] }) {
  return <Panel label={sanction.seasonName} contentClassName="p-5"><div className="space-y-3 text-sm leading-6 text-[var(--color-fg-mid)]"><p>{sanction.effects.map((effect) => SANCTION_EFFECT_LABELS[effect as keyof typeof SANCTION_EFFECT_LABELS] ?? effect).join("、")}</p><p>{formatCST(sanction.effectiveFrom)} 起{sanction.effectiveUntil ? `，至 ${formatCST(sanction.effectiveUntil)}` : "，未设截止时间"}。</p>{sanction.explanation && <p>说明：{sanction.explanation}</p>}<Button size="sm" variant="outline" asChild><Link href={`/${sanction.seasonSlug}/register` as never}>查看本届赛事</Link></Button></div></Panel>;
}

export function MyReadinessDashboard({ model }: { model: MyWorkspaceModel }) {
  const blockedSanctions = model.sanctions.length > 0;
  const readiness = model.readiness;
  const taskGroups = new Map<string, TaskAction[]>();
  for (const task of model.tasks) {
    const competition = readiness.competitions.find(row => row.entry.id === task.id || row.qualification.id === task.id);
    const context = competition ? `${competition.seasonName} · ${competition.name}` : "";
    // Only coalesce identical profile blockers; preserve every affected event link.
    const profileTask = task.id === "profile" || task.id.startsWith("qualification-");
    const key = profileTask && !task.secondaryCta
      ? JSON.stringify(["profile", task.detail, task.responsibility]) : task.id;
    const group = taskGroups.get(key) ?? [];
    group.push({ item: task, context });
    taskGroups.set(key, group);
  }
  return <div className="space-y-6">
    <PageHeader eyebrow="MY RIVALHUB" title="我的参赛" />

    <Section>
      <SectionHeader title="需要你处理" />
      {taskGroups.size > 0 ? <div className={taskGroups.size > 1 ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}>{[...taskGroups.entries()].map(([key, tasks]) => <ReadinessCard key={key} item={tasks.some(task => task.item.id === "profile") ? { ...tasks[0]!.item, title: "个人资料" } : tasks[0]!.item} context={tasks.length === 1 ? tasks[0]!.context : undefined} relatedTasks={tasks.length > 1 ? tasks : undefined} />)}</div> : <StatusBanner tone="success" title="暂无待办" />}
    </Section>

    {model.upcomingMatches.length > 0 && <Section><SectionHeader title="接下来" /><div className="grid gap-4 md:grid-cols-2">{model.upcomingMatches.map((match) => <Panel key={`${match.seasonId}-${match.task.href}`} label={match.seasonName} contentClassName="p-5"><div className="space-y-3"><div><p className="font-semibold"><TeamProfileLink seasonSlug={match.seasonSlug} entryId={match.entryId}>{match.entryName}</TeamProfileLink></p><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{match.task.title} · {match.task.detail}</p></div><Button size="sm" variant="outline" asChild><Link href={match.task.href as never}>查看比赛</Link></Button></div></Panel>)}</div></Section>}

    <Section><SectionHeader title="当前参与" /><div className="grid items-start gap-4 lg:grid-cols-2"><TeamSummary model={model} />{model.currentCompetitions.length > 0 ? <div className="grid gap-4">{model.currentCompetitions.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div> : <Panel contentClassName="p-5"><p className="text-sm text-[var(--color-fg-mid)]">当前没有负责或参与中的赛事。</p></Panel>}</div></Section>

    <Section><SectionHeader title="参赛资料" /><div className="grid gap-4 md:grid-cols-2">{!model.tasks.some(task => task.id === readiness.profile.id) && <ReadinessCard item={readiness.profile} />}{!model.tasks.some(task => task.id === readiness.education.id) && <ReadinessCard item={readiness.education} />}{readiness.competitiveProfiles.map((profile) => <CompetitiveCard key={profile.key} profile={profile} />)}</div></Section>

    {blockedSanctions && <Section><SectionHeader title="当前有效的个人纪律限制" /><div className="grid gap-4 md:grid-cols-2">{model.sanctions.map((sanction) => <SanctionCard key={sanction.id} sanction={sanction} />)}</div></Section>}

    {model.historyCompetitions.length > 0 && <Section><SectionHeader title="历史赛事" /><div className="grid gap-4 xl:grid-cols-2">{model.historyCompetitions.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div></Section>}
  </div>;
}
