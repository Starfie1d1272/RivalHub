"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Fact = { rank: string; rating: string };

export type CompetitiveSeasonContext = {
  platform: string;
  /** Active catalogued seasons, current season first, then previous, then the rest. */
  seasons: Array<{ seasonKey: string; label: string; rankOrder: string[]; isCurrent: boolean; isPrevious: boolean }>;
  facts: Array<{ kind: "historical_peak" | "season_peak"; platformSeasonKey: string | null; rank: string; rating: string }>;
};

/**
 * Long-term competitive profile maintenance. Any catalogued platform season
 * can carry a season peak, so participants can backfill facts for an older
 * season that a published event froze into its qualification context. Blank
 * season fields are left unsaved — not every season has to be filled.
 */
export function CompetitiveProfileForm({ contexts }: { contexts: CompetitiveSeasonContext[] }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [platform, setPlatform] = useState(contexts[0]?.platform ?? "");
  const context = contexts.find((item) => item.platform === platform) ?? null;
  const [historical, setHistorical] = useState<Fact>(() => {
    const fact = contexts[0]?.facts.find((item) => item.kind === "historical_peak" && item.platformSeasonKey === null);
    return fact ? { rank: fact.rank, rating: fact.rating } : { rank: "", rating: "" };
  });
  const [seasonFacts, setSeasonFacts] = useState<Record<string, Fact>>(() => {
    const initial: Record<string, Fact> = {};
    for (const fact of contexts[0]?.facts ?? []) {
      if (fact.kind === "season_peak" && fact.platformSeasonKey) initial[fact.platformSeasonKey] = { rank: fact.rank, rating: fact.rating };
    }
    return initial;
  });

  const seasonFields = useMemo(() => context?.seasons ?? [], [context]);

  function choosePlatform(nextPlatform: string) {
    const next = contexts.find((item) => item.platform === nextPlatform);
    setPlatform(nextPlatform);
    setSaved(false);
    const historicalFact = next?.facts.find((item) => item.kind === "historical_peak" && item.platformSeasonKey === null);
    setHistorical(historicalFact ? { rank: historicalFact.rank, rating: historicalFact.rating } : { rank: "", rating: "" });
    const nextFacts: Record<string, Fact> = {};
    for (const fact of next?.facts ?? []) {
      if (fact.kind === "season_peak" && fact.platformSeasonKey) nextFacts[fact.platformSeasonKey] = { rank: fact.rank, rating: fact.rating };
    }
    setSeasonFacts(nextFacts);
  }

  if (!context || seasonFields.length === 0 || seasonFields.every((season) => season.rankOrder.length === 0)) {
    return <StatusBanner tone="warn" title="竞技平台赛季目录尚未完善" sub="管理员需要在平台赛季目录中标记当前赛季并维护段位顺序后，才可提交用于资格审核的竞技资料。" />;
  }

  const currentSeason = seasonFields.find((season) => season.isCurrent);
  const filledSeasonPeaks = seasonFields
    .map((season) => ({ season, fact: seasonFacts[season.seasonKey] ?? { rank: "", rating: "" } }))
    .filter(({ fact }) => fact.rank.trim() !== "" || fact.rating.trim() !== "");

  const field = (title: string, fact: Fact, setFact: (fact: Fact) => void, hint: string, rankOrder: string[]) => (
    <section className="space-y-3 border-l-2 border-[var(--color-border-hi)] pl-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-mid)]">{hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>段位</Label>
          <Select value={fact.rank || undefined} onValueChange={(rank) => { setSaved(false); setFact({ ...fact, rank }); }}>
            <SelectTrigger><SelectValue placeholder="选择最高段位" /></SelectTrigger>
            <SelectContent>{rankOrder.map((rank) => <SelectItem key={rank} value={rank}>{rank}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>对应 Rating</Label>
          <Input value={fact.rating} onChange={(event) => { setSaved(false); setFact({ ...fact, rating: event.target.value }); }} inputMode="decimal" placeholder="可填写对应 Rating" />
        </div>
      </div>
    </section>
  );

  return <Panel label="竞技档案" pad={20}>
    <div className="space-y-5">
      {contexts.length > 1 && <div className="space-y-1.5"><Label>竞技平台</Label><Select value={platform} onValueChange={choosePlatform}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{contexts.map((item) => <SelectItem key={item.platform} value={item.platform}>{item.platform}</SelectItem>)}</SelectContent></Select></div>}
      <StatusBanner tone="info" title={`${context.platform} · 赛季资料`} sub={currentSeason ? `当前赛季：${currentSeason.label}。历史赛季也可以补充维护，供冻结了该赛季的赛事使用。` : "请如实自行申报。"} />
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">系统依照赛事已公布的段位顺序比较资料；Rating 仅在规则指定的同分比较中使用。未公布的跨平台换算不会由此页面推断。</p>
      {field("历史最高", historical, setHistorical, "不限定平台赛季，填写个人历史最高纪录", currentSeason?.rankOrder ?? [])}
      {seasonFields.map((season) => field(
        `${season.isCurrent ? "当前赛季" : season.isPrevious ? "上一赛季" : "历史赛季"} · ${season.label}`,
        seasonFacts[season.seasonKey] ?? { rank: "", rating: "" },
        (fact) => { setSaved(false); setSeasonFacts((current) => ({ ...current, [season.seasonKey]: fact })); },
        `平台赛季 ${season.label}（可留空）`,
        season.rankOrder,
      ))}
      {saved && <StatusBanner tone="success" title="竞技档案已保存" sub="报名和赛务审核会使用你最新保存的资料。" />}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => {
          const partial = filledSeasonPeaks.find(({ fact }) => fact.rank.trim() === "" || fact.rating.trim() === "");
          if (partial) { toast.error(`「${partial.season.label}」需要同时填写段位与 Rating，或整项留空。`); return; }
          if (historical.rank.trim() === "" || historical.rating.trim() === "") { toast.error("历史最高需要同时填写段位与 Rating。"); return; }
          startTransition(async () => {
            const result = await saveCompetitiveProfile({
              platform: context.platform,
              historicalPeak: historical,
              seasonPeaks: filledSeasonPeaks.map(({ season, fact }) => ({ seasonKey: season.seasonKey, rank: fact.rank, rating: fact.rating })),
            });
            if (result.success) { setSaved(true); toast.success("竞技档案已保存"); } else toast.error(result.error.message);
          });
        }}>{pending ? "保存中…" : "保存竞技档案"}</Button>
        <span className="font-mono text-[11px] text-[var(--color-fg-mid)]">段位与 Rating 可稍后补充；报名时将说明缺失项。</span>
      </div>
    </div>
  </Panel>;
}
