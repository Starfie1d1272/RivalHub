import React from "react";
import Link from "next/link";
import { MyCompetitionCard } from "@/components/my/MyCompetitionCard";
import { PageHeader, Panel, Section, SectionHeader, StatusBanner, StatusPill } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { TeamLogo } from "@/components/teams/TeamLogo";
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

function ReadinessCard({ item }: { item: MyReadinessItem }) {
  const state = STATE[item.state];
  const responsibility = item.responsibility;
  return (
    <div className="space-y-3 border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><StatusPill label={state.label} tone={state.tone} /></div>
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{item.detail}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {responsibility && <span className="text-xs text-[var(--color-fg-dim)]">{presentMyReadinessResponsibility(responsibility)}</span>}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant={item.secondaryCta ? "default" : "outline"} asChild><Link href={item.cta.href as never}>{item.cta.label}</Link></Button>{item.secondaryCta && <Button size="sm" variant="outline" asChild><Link href={item.secondaryCta.href as never}>{item.secondaryCta.label}</Link></Button>}</div>
      </div>
    </div>
  );
}

function CompetitiveCard({ profile }: { profile: MyReadinessModel["competitiveProfiles"][number] }) {
  const state = STATE[profile.state];
  return <div className="space-y-3 border border-[var(--color-border)] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{profile.displayName} 竞技档案</h3><StatusPill label={state.label} tone={state.tone} /></div><p className="text-sm leading-6 text-[var(--color-fg-mid)]">{profile.blockers.length === 0 ? "历史最高、当前与上一赛季资料齐全。具体赛事仍只使用其实际开放报名时冻结的上下文。" : profile.blockers.join(" ")}</p><Button size="sm" variant="outline" asChild><Link href="/settings/competitive">维护竞技档案</Link></Button></div>;
}

function TeamSummary({ model }: { model: MyWorkspaceModel }) {
  if (!model.currentTeam) return <ReadinessCard item={model.readiness.team} />;
  const team = model.currentTeam;
  return <Panel label="当前队伍" contentClassName="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><TeamLogo logoUrl={team.logoUrl} teamName={team.name} size="lg" /><div className="min-w-0 flex-1 space-y-2"><div><h3 className="text-lg font-semibold">{team.name}</h3><p className="text-sm text-[var(--color-fg-mid)]">你是{team.viewerRole === "captain" ? "队长" : "成员"}；队伍成员变更不会改写已经提交、审核通过或冻结的赛事名单。</p></div><Button size="sm" variant="outline" asChild><Link href="/my/teams">{team.viewerRole === "captain" ? "管理我的队伍" : "查看我的队伍"}</Link></Button></div></div></Panel>;
}

function SanctionCard({ sanction }: { sanction: MyWorkspaceModel["sanctions"][number] }) {
  return <Panel label={sanction.seasonName} contentClassName="p-5"><div className="space-y-3 text-sm leading-6 text-[var(--color-fg-mid)]"><p>{sanction.effects.map((effect) => SANCTION_EFFECT_LABELS[effect as keyof typeof SANCTION_EFFECT_LABELS] ?? effect).join("、")}</p><p>{formatCST(sanction.effectiveFrom)} 起{sanction.effectiveUntil ? `，至 ${formatCST(sanction.effectiveUntil)}` : "，未设截止时间"}。</p>{sanction.explanation && <p>说明：{sanction.explanation}</p>}<Button size="sm" variant="outline" asChild><Link href={`/${sanction.seasonSlug}/register` as never}>查看本届赛事</Link></Button></div></Panel>;
}

export function MyReadinessDashboard({ model }: { model: MyWorkspaceModel }) {
  const blockedSanctions = model.sanctions.length > 0;
  const readiness = model.readiness;
  return <div className="space-y-8">
    <PageHeader eyebrow="MY RIVALHUB" title="我的参赛" description={`你好，${model.displayName}。这里先列出需要你处理的事项，再汇总当前队伍、赛事进度与参赛资料；资料齐全不等于某届赛事一定可报名或出场。`} />

    <Section>
      <SectionHeader title="需要你处理" description={model.tasks.length > 0 ? "优先处理会改变你当前参赛路径的事项。" : "目前没有需要你处理的参赛事项。"} />
      {model.tasks.length > 0 ? <div className="grid gap-4 md:grid-cols-2">{model.tasks.map((item) => <ReadinessCard key={item.id} item={item} />)}</div> : <StatusBanner tone="success" title="当前没有待处理事项" sub="赛事审核、正式参赛名单和单场出场仍以各自的实时事实为准。" />}
    </Section>

    {model.upcomingMatches.length > 0 && <Section><SectionHeader title="接下来" description="当前比赛只取已确认或已冻结赛事名单中的比赛事实。" /><div className="grid gap-4 md:grid-cols-2">{model.upcomingMatches.map((match) => <Panel key={`${match.seasonId}-${match.task.href}`} label={match.seasonName} contentClassName="p-5"><div className="space-y-3"><div><p className="font-semibold">{match.entryName}</p><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{match.task.title} · {match.task.detail}</p></div><Button size="sm" variant="outline" asChild><Link href={match.task.href as never}>查看比赛</Link></Button></div></Panel>)}</div></Section>}

    <Section><SectionHeader title="当前参与" description="队伍关系与本届赛事身份分别展示。" /><TeamSummary model={model} />{model.currentCompetitions.length > 0 ? <div className="grid gap-4 xl:grid-cols-2">{model.currentCompetitions.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div> : <Panel contentClassName="p-5"><p className="text-sm text-[var(--color-fg-mid)]">当前没有负责或参与中的赛事。</p></Panel>}</Section>

    <Section><SectionHeader title="参赛资料" description="这些是持续维护的个人、教育和竞技事实；赛事会按当届规则单独核验。" /><div className="grid gap-4 md:grid-cols-2"><ReadinessCard item={readiness.profile} /><ReadinessCard item={readiness.education} />{readiness.competitiveProfiles.map((profile) => <CompetitiveCard key={profile.key} profile={profile} />)}</div></Section>

    {blockedSanctions && <Section><SectionHeader title="当前有效的个人纪律限制" description="处罚效果按具体赛事和能力生效。" /><div className="grid gap-4 md:grid-cols-2">{model.sanctions.map((sanction) => <SanctionCard key={sanction.id} sanction={sanction} />)}</div></Section>}

    {model.historyCompetitions.length > 0 && <Section><SectionHeader title="历史赛事" description="已结束和已归档赛事按赛季时间倒序展示。" /><div className="grid gap-4 xl:grid-cols-2">{model.historyCompetitions.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div></Section>}
  </div>;
}
