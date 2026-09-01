import React from "react";
import Link from "next/link";
import { Panel, StatusBanner } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { formatCST } from "@/lib/utils/date";
import {
  SANCTION_EFFECT_LABELS,
  type MyReadinessItem,
  type MyReadinessModel,
  type MyReadinessState,
} from "@/lib/my/readiness";

const STATE: Record<MyReadinessState, { label: string; tone: "success" | "warn" | "error" | "info" }> = {
  ready: { label: "已准备", tone: "success" },
  incomplete: { label: "待完善", tone: "warn" },
  waiting: { label: "等待处理", tone: "info" },
  blocked: { label: "当前受阻", tone: "error" },
  unknown: { label: "暂时无法确认", tone: "warn" },
  not_applicable: { label: "不适用", tone: "info" },
};

function ReadinessCard({ item }: { item: MyReadinessItem }) {
  const state = STATE[item.state];
  return <div className="space-y-3 border border-[var(--color-border)] p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><span className="font-mono text-[10px] text-[var(--color-fg-mid)]">{state.label}</span></div><p className="text-sm leading-6 text-[var(--color-fg-mid)]">{item.detail}</p><div className="flex flex-wrap items-center justify-between gap-3">{item.owner && <span className="text-xs text-[var(--color-fg-dim)]">等待 {item.owner} 处理</span>}<div className="flex flex-wrap gap-2"><Button size="sm" asChild><Link href={item.cta.href as never}>{item.cta.label}</Link></Button>{item.secondaryCta && <Button size="sm" variant="outline" asChild><Link href={item.secondaryCta.href as never}>{item.secondaryCta.label}</Link></Button>}</div></div></div>;
}

function CompetitiveCard({ profile }: { profile: MyReadinessModel["competitiveProfiles"][number] }) {
  const state = STATE[profile.state];
  return <div className="border border-[var(--color-border)] p-4 space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{profile.displayName} 竞技档案</h3><span className="font-mono text-[10px] text-[var(--color-fg-mid)]">{state.label}</span></div><p className="text-sm leading-6 text-[var(--color-fg-mid)]">{profile.blockers.length === 0 ? "历史最高、当前与上一赛季资料齐全。具体赛事仍只使用其发布时冻结的上下文。" : profile.blockers.join(" ")}</p><Button size="sm" variant="outline" asChild><Link href="/settings/competitive">维护竞技档案</Link></Button></div>;
}

export function MyReadinessDashboard({ model }: { model: MyReadinessModel }) {
  const blockedSanctions = model.sanctions.length > 0;
  const attachedSanctionIds = new Set(model.competitions.flatMap((competition) => competition.sanctions.map((sanction) => sanction.id)));
  const standaloneSanctions = model.sanctions.filter((sanction) => !attachedSanctionIds.has(sanction.id));
  return <div className="container mx-auto max-w-6xl space-y-6 px-4 py-12 sm:py-16"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">MY RIVALHUB</p><h1 className="mt-1 text-3xl font-semibold">我的参赛</h1><p className="mt-2 text-sm text-[var(--color-fg-mid)]">你好，{model.displayName}。这里汇总参赛资料与当前赛事进度；资料齐全不等于某届赛事一定可报名或出场。</p></div>
    <StatusBanner tone={blockedSanctions ? "error" : "info"} title={blockedSanctions ? "存在当前有效的个人纪律限制" : "参赛资料与赛事报名分别核验"} sub={blockedSanctions ? "处罚效果按具体赛事和能力生效；请查看下方赛事卡。" : "报名审核、正式参赛名单、单场首发与纪律限制不会由资料状态替代。"} />
    <section className="space-y-3"><div><h2 className="text-lg font-semibold">长期参与者资料</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">这些是持续维护的个人、教育和竞技事实。</p></div><div className="grid gap-4 md:grid-cols-2"><ReadinessCard item={model.profile} /><ReadinessCard item={model.education} />{model.competitiveProfiles.map((profile) => <CompetitiveCard key={profile.key} profile={profile} />)}<ReadinessCard item={model.team} /></div></section>
    {standaloneSanctions.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold text-[var(--color-danger)]">当前有效的个人纪律限制</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">这些限制尚未关联到赛事报名，仍会按所列赛事与能力生效。</p></div><div className="grid gap-4 md:grid-cols-2">{standaloneSanctions.map((sanction) => <Panel key={sanction.id} label={sanction.seasonName} pad={20}><div className="space-y-3 text-sm leading-6 text-[var(--color-fg-mid)]"><p>{sanction.effects.map((effect) => SANCTION_EFFECT_LABELS[effect as keyof typeof SANCTION_EFFECT_LABELS] ?? effect).join("、")}</p><p>{formatCST(sanction.effectiveFrom)} 起{sanction.effectiveUntil ? `，至 ${formatCST(sanction.effectiveUntil)}` : "，未设截止时间"}。</p>{sanction.explanation && <p>说明：{sanction.explanation}</p>}<Button size="sm" variant="outline" asChild><Link href={`/${sanction.seasonSlug}/register` as never}>查看本届赛事</Link></Button></div></Panel>)}</div></section>}
    <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">我的赛事</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">报名、个人竞技资料与纪律限制会按赛事分别展示。</p></div><Button variant="outline" asChild><Link href="/my/competitions">查看全部赛事</Link></Button></div>{model.competitions.length === 0 ? <Panel pad={20}><p className="text-sm text-[var(--color-fg-mid)]">你当前没有负责或参与的赛事报名。</p></Panel> : <div className="space-y-4">{model.competitions.map((competition) => <Panel key={competition.id} label={competition.seasonName} pad={20}><div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{competition.name}</h3><p className="mt-1 text-sm text-[var(--color-fg-mid)]">个人竞技资料只说明你的资料是否符合本届赛事要求；不代替报名审核或正式参赛名单确认。</p></div><Button size="sm" variant="outline" asChild><Link href={competition.href as never}>进入报名页</Link></Button></div><div className="grid gap-4 md:grid-cols-2"><ReadinessCard item={competition.entry} /><ReadinessCard item={competition.qualification} /></div>{competition.sanctions.length > 0 && <div className="space-y-2 border-t border-[var(--color-border)] pt-4"><h4 className="font-semibold text-[var(--color-danger)]">当前有效的个人纪律限制</h4>{competition.sanctions.map((sanction) => <div key={sanction.id} className="text-sm leading-6 text-[var(--color-fg-mid)]"><p>{sanction.effects.map((effect) => SANCTION_EFFECT_LABELS[effect as keyof typeof SANCTION_EFFECT_LABELS] ?? effect).join("、")}</p><p>{formatCST(sanction.effectiveFrom)} 起{sanction.effectiveUntil ? `，至 ${formatCST(sanction.effectiveUntil)}` : "，未设截止时间"}。</p>{sanction.explanation && <p>说明：{sanction.explanation}</p>}</div>)}</div>}</div></Panel>)}</div>}</section>
  </div>;
}
