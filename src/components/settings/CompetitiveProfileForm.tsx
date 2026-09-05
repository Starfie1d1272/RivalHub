"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, StatusBanner } from "@/components/rivalhub";

type FactStatus = "ranked" | "unranked" | "unrecorded";
type Fact = { status: FactStatus; rank: string; rating: string; stars: string };
const HISTORICAL_KEY = "historical";
const emptyFact = (): Fact => ({ status: "unrecorded", rank: "", rating: "", stars: "" });

export type CompetitiveSeasonContext = {
  platform: string;
  platformDisplayName: string;
  ratingLabel: string;
  ladder: Array<{ rankKey: string; label: string; starMin: number | null; starMax: number | null }>;
  seasons: Array<{ seasonKey: string; label: string; isCurrent: boolean; isPrevious: boolean }>;
  facts: Array<{ kind: "historical_peak" | "season_peak"; platformSeasonKey: string | null; status?: "ranked" | "unranked"; rank: string | null; rating: string | null; stars: number | null; achievedSeasonKey?: string | null }>;
};

function factFor(context: CompetitiveSeasonContext | undefined, key: string): Fact {
  const row = context?.facts.find((fact) => (key === HISTORICAL_KEY ? fact.kind === "historical_peak" : fact.kind === "season_peak" && fact.platformSeasonKey === key));
  return row ? { status: row.status ?? "ranked", rank: row.rank ?? "", rating: row.rating ?? "", stars: row.stars === null ? "" : String(row.stars) } : emptyFact();
}

function summary(fact: Fact, context: CompetitiveSeasonContext): string {
  if (fact.status === "unrecorded") return "未录入";
  if (fact.status === "unranked") return fact.rating ? `未定级 · ${context.ratingLabel} ${fact.rating}` : "未定级";
  const rank = context.ladder.find((entry) => entry.rankKey === fact.rank)?.label ?? fact.rank;
  return `${rank}${fact.stars ? ` · ${fact.stars}★` : ""}${fact.rating ? ` · ${context.ratingLabel} ${fact.rating}` : ""}`;
}

/** Keep recent editors fixed while exposing older catalog facts on demand. */
export function CompetitiveProfileForm({ contexts }: { contexts: CompetitiveSeasonContext[] }) {
  const [pending, startTransition] = useTransition();
  const first = contexts.find((item) => item.platform === "perfect_world") ?? contexts[0];
  const [platform, setPlatform] = useState(first?.platform ?? "");
  const context = contexts.find((item) => item.platform === platform) ?? null;
  const [historical, setHistorical] = useState<Fact>(() => ({ ...factFor(first, HISTORICAL_KEY), status: "ranked" }));
  const [achievedSeasonKey, setAchievedSeasonKey] = useState(() => first?.facts.find((fact) => fact.kind === "historical_peak")?.achievedSeasonKey ?? "unknown");
  const [seasonFacts, setSeasonFacts] = useState<Record<string, Fact>>(() => Object.fromEntries((first?.seasons ?? []).map((season) => [season.seasonKey, factFor(first, season.seasonKey)])));
  const [expanded, setExpanded] = useState(false);
  const [editingHistory, setEditingHistory] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function choosePlatform(nextPlatform: string) {
    const next = contexts.find((item) => item.platform === nextPlatform);
    setPlatform(nextPlatform);
    setHistorical({ ...factFor(next, HISTORICAL_KEY), status: "ranked" });
    setAchievedSeasonKey(next?.facts.find((fact) => fact.kind === "historical_peak")?.achievedSeasonKey ?? "unknown");
    setSeasonFacts(Object.fromEntries((next?.seasons ?? []).map((season) => [season.seasonKey, factFor(next, season.seasonKey)])));
    setExpanded(false); setEditingHistory(null); setSaved(false);
  }

  const platformSelect = contexts.length > 1 ? <div className="space-y-1.5"><Label htmlFor="competitive-platform">竞技平台</Label><Select value={platform} onValueChange={choosePlatform}><SelectTrigger id="competitive-platform"><SelectValue /></SelectTrigger><SelectContent>{contexts.map((item) => <SelectItem key={item.platform} value={item.platform}>{item.platformDisplayName}</SelectItem>)}</SelectContent></Select></div> : null;
  if (!context || context.ladder.length === 0 || !context.seasons.some((season) => season.isCurrent)) return <Panel label="竞技资料" contentClassName="p-5"><div className="space-y-5">{platformSelect}<StatusBanner tone="warn" title="当前竞技平台目录尚未完善" sub="管理员需要配置平台段位表和当前赛季后，才可维护这份长期竞技资料。" /></div></Panel>;

  const recentSeasons = context.seasons.filter((season) => season.isCurrent || season.isPrevious);
  const olderSeasons = context.seasons.filter((season) => !season.isCurrent && !season.isPrevious);
  const maintainedOlder = new Set(olderSeasons.filter((season) => seasonFacts[season.seasonKey]?.status !== "unrecorded").map((season) => season.seasonKey));
  const visibleOlderSeasons = expanded ? olderSeasons : olderSeasons.filter((season) => maintainedOlder.has(season.seasonKey) || editingHistory === season.seasonKey);
  const hiddenOlderCount = olderSeasons.filter((season) => !maintainedOlder.has(season.seasonKey)).length;

  function editor(title: string, key: string, fact: Fact, setFact: (value: Fact) => void, allowUnrecorded: boolean, options: { after?: React.ReactNode; onCollapse?: () => void } = {}) {
    const selected = context!.ladder.find((entry) => entry.rankKey === fact.rank);
    const hasStars = selected?.starMin !== null && selected?.starMin !== undefined;
    return <section key={key} className="space-y-3 border-l-2 border-[var(--color-border-hi)] pl-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-xs text-[var(--color-fg-mid)]">{summary(fact, context!)}</span>
          {options.onCollapse && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]" aria-label={`收起 ${title}`} onClick={options.onCollapse}>收起</Button>}
        </div>
      </div>
      {allowUnrecorded && <div className="max-w-56 space-y-1.5"><Label>资料状态</Label><Select value={fact.status} onValueChange={(status) => { setSaved(false); setFact(status === "ranked" ? { ...fact, status } : { status: status as FactStatus, rank: "", rating: status === "unranked" ? fact.rating : "", stars: "" }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unrecorded">未录入</SelectItem><SelectItem value="unranked">未定级</SelectItem><SelectItem value="ranked">已定级</SelectItem></SelectContent></Select></div>}
      {fact.status === "unrecorded" && <p className="text-sm text-[var(--color-fg-mid)]">尚未对这届作出声明；赛事若明确要求这届且没有可用 fallback，会提示你补充资料。</p>}
      {fact.status === "unranked" && <div className="max-w-sm space-y-1.5"><Label>对应 {context!.ratingLabel}（可选）</Label><Input value={fact.rating} onChange={(event) => { setSaved(false); setFact({ ...fact, rating: event.target.value }); }} inputMode="decimal" placeholder="没有可留空" /></div>}
      {fact.status === "ranked" && <div className={`grid gap-3 ${hasStars ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="space-y-1.5"><Label>段位</Label><Select value={fact.rank || undefined} onValueChange={(rank) => { setSaved(false); setFact({ ...fact, rank, stars: "" }); }}><SelectTrigger><SelectValue placeholder="选择段位" /></SelectTrigger><SelectContent>{context!.ladder.map((entry) => <SelectItem key={entry.rankKey} value={entry.rankKey}>{entry.label}</SelectItem>)}</SelectContent></Select></div>
        {hasStars && <div className="space-y-1.5"><Label>星数</Label><Input required value={fact.stars} onChange={(event) => { setSaved(false); setFact({ ...fact, stars: event.target.value }); }} inputMode="numeric" type="number" min={selected?.starMin ?? undefined} max={selected?.starMax ?? undefined} step={1} placeholder={`${selected?.starMin}–${selected?.starMax ?? "∞"}`} /></div>}
        <div className="space-y-1.5"><Label>对应 {context!.ratingLabel}</Label><Input value={fact.rating} onChange={(event) => { setSaved(false); setFact({ ...fact, rating: event.target.value }); }} inputMode="decimal" /></div>
      </div>}
      {options.after}
    </section>;
  }

  function compactHistory(title: string, key: string, fact: Fact) {
    const action = fact.status === "unrecorded" ? "补充" : "编辑";
    return <section key={key} className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--color-border-hi)] pl-4">
      <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{summary(fact, context!)}</p></div>
      <Button type="button" variant="outline" size="sm" aria-label={`${action} ${title}`} onClick={() => setEditingHistory(key)}>{action}</Button>
    </section>;
  }

  const invalidRanked = (key: string, fact: Fact) => {
    if (fact.status !== "ranked") return false;
    const rank = context.ladder.find((entry) => entry.rankKey === fact.rank);
    const needsStars = rank?.starMin !== null && rank?.starMin !== undefined && fact.stars === "";
    return !fact.rank || !fact.rating || needsStars;
  };

  return <Panel label="竞技资料" contentClassName="p-5"><div className="space-y-5">
    {platformSelect}
    <StatusBanner tone="info" title={`${context.platformDisplayName} · 长期竞技资料`} sub="未录入表示尚未声明；未定级是有效事实；已定级必须填写段位、星段位的准确星数与 Rating。具体赛事会按当届冻结规则单独核验。" />
    {editor("历史最高", HISTORICAL_KEY, historical, setHistorical, false, { after: <div className="max-w-sm space-y-1.5"><Label htmlFor="competitive-achieved-season">历史最高达成赛季（可选）</Label><Select value={achievedSeasonKey} onValueChange={(value) => { setSaved(false); setAchievedSeasonKey(value); }}><SelectTrigger id="competitive-achieved-season"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">不确定 / 暂不填写</SelectItem>{context.seasons.map((season) => <SelectItem key={season.seasonKey} value={season.seasonKey}>{season.label}</SelectItem>)}</SelectContent></Select></div> })}
    <section aria-labelledby="recent-seasons-heading" className="space-y-4">
      <div><h2 id="recent-seasons-heading" className="text-base font-semibold">近期赛季</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">当前、上一赛季可直接维护。</p></div>
      {recentSeasons.map((season) => {
      const title = `${season.isCurrent ? "当前赛季" : season.isPrevious ? "上一赛季" : "历史赛季"} · ${season.label}`;
      const fact = seasonFacts[season.seasonKey] ?? emptyFact();
      const setFact = (value: Fact) => { setSaved(false); setSeasonFacts((current) => ({ ...current, [season.seasonKey]: value })); };
      return editor(title, season.seasonKey, fact, setFact, true);
      })}
    </section>
    {olderSeasons.length > 0 && <section aria-labelledby="older-history-heading" className="space-y-4">
      <div><h2 id="older-history-heading" className="text-base font-semibold">更早历史资料</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">已维护的历史事实会保留在这里；其它赛季可按需查看和补充。</p></div>
      {visibleOlderSeasons.map((season) => {
        const title = `历史赛季 · ${season.label}`;
        const fact = seasonFacts[season.seasonKey] ?? emptyFact();
        const setFact = (value: Fact) => { setSaved(false); setSeasonFacts((current) => ({ ...current, [season.seasonKey]: value })); };
        return editingHistory === season.seasonKey
          ? editor(title, season.seasonKey, fact, setFact, true, { onCollapse: () => setEditingHistory(null) })
          : compactHistory(title, season.seasonKey, fact);
      })}
      {hiddenOlderCount > 0 && <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "收起历史赛季" : `查看全部历史赛季（${hiddenOlderCount}）`}</Button>}
    </section>}
    {saved && <StatusBanner tone="success" title="竞技档案已保存" sub="报名和赛务审核会使用你最新保存的资料。" />}
    <div className="flex flex-wrap items-center gap-3"><Button disabled={pending} onClick={() => {
      if (invalidRanked(HISTORICAL_KEY, historical)) { toast.error("历史最高需要填写段位、Rating，以及所选段位要求的星数。"); return; }
      const invalid = context.seasons.find((season) => invalidRanked(season.seasonKey, seasonFacts[season.seasonKey] ?? emptyFact()));
      if (invalid) { toast.error(`「${invalid.label}」已选择已定级，请补齐段位、Rating 与所需星数。`); return; }
      const payload = { platform: context.platform, historicalPeak: { status: "ranked" as const, rank: historical.rank, rating: Number(historical.rating), stars: historical.stars === "" ? null : Number(historical.stars), achievedSeasonKey: achievedSeasonKey === "unknown" ? null : achievedSeasonKey }, seasonPeaks: context.seasons.map((season) => { const fact = seasonFacts[season.seasonKey] ?? emptyFact(); return fact.status === "ranked" ? { seasonKey: season.seasonKey, status: "ranked" as const, rank: fact.rank, rating: Number(fact.rating), stars: fact.stars === "" ? null : Number(fact.stars) } : fact.status === "unranked" ? { seasonKey: season.seasonKey, status: "unranked" as const, rating: fact.rating === "" ? null : Number(fact.rating) } : { seasonKey: season.seasonKey, status: "unrecorded" as const }; }) };
      startTransition(async () => { const result = await saveCompetitiveProfile(payload); if (result.success) { setSaved(true); toast.success("竞技档案已保存"); } else toast.error(result.error.message); });
    }}>{pending ? "保存中…" : "保存竞技档案"}</Button><span className="font-mono text-[11px] text-[var(--color-fg-mid)]">把已存资料改回“未录入”会删除该赛季声明。</span></div>
  </div></Panel>;
}
