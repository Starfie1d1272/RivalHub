"use client";

import React, { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Fact = { rank: string; rating: string; stars: string };
type InitialFact = { rank: string; rating: string; stars: number | null };

const HISTORICAL_KEY = "historical";

function collectInitialFacts(context: CompetitiveSeasonContext | undefined): Record<string, InitialFact> {
  const initial: Record<string, InitialFact> = {};
  for (const fact of context?.facts ?? []) {
    const key = fact.kind === "historical_peak" ? HISTORICAL_KEY : fact.platformSeasonKey;
    if (key) initial[key] = { rank: fact.rank, rating: fact.rating, stars: fact.stars };
  }
  return initial;
}

export type CompetitiveSeasonContext = {
  platform: string;
  platformDisplayName: string;
  /** Platform-defined canonical performance Rating, such as Rating Pro / Rating+. */
  ratingLabel: string;
  /** Platform-owned rank ladder, lowest → highest. Ranks store stable keys; the UI shows labels. */
  ladder: Array<{ rankKey: string; label: string; starMin: number | null; starMax: number | null }>;
  /** Catalogued seasons, latest first. */
  seasons: Array<{ seasonKey: string; label: string; isCurrent: boolean; isPrevious: boolean }>;
  facts: Array<{ kind: "historical_peak" | "season_peak"; platformSeasonKey: string | null; rank: string; rating: string; stars: number | null }>;
};

/**
 * Long-term competitive profile maintenance. Any catalogued platform season
 * can carry a season peak, so participants can backfill facts for an older
 * season that a published event froze into its qualification context. Blank
 * season fields are left unsaved — not every season has to be filled. The
 * select shows display labels; the server stores stable rank keys.
 */
export function CompetitiveProfileForm({ contexts }: { contexts: CompetitiveSeasonContext[] }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const isComplete = (item: CompetitiveSeasonContext | undefined) => Boolean(
    item && item.ladder.length > 0 && item.seasons.some((season) => season.isCurrent) && item.seasons.some((season) => season.isPrevious),
  );
  const initialContext = contexts.find((item) => item.platform === "perfect_world" && isComplete(item)) ?? contexts.find(isComplete) ?? contexts[0];
  const firstUsablePlatform = initialContext?.platform ?? "";
  const [platform, setPlatform] = useState(firstUsablePlatform);
  const context = contexts.find((item) => item.platform === platform) ?? null;
  const [historical, setHistorical] = useState<Fact>(() => {
    const fact = initialContext?.facts.find((item) => item.kind === "historical_peak" && item.platformSeasonKey === null);
    return fact ? { rank: fact.rank, rating: fact.rating, stars: fact.stars === null ? "" : String(fact.stars) } : { rank: "", rating: "", stars: "" };
  });
  const [seasonFacts, setSeasonFacts] = useState<Record<string, Fact>>(() => {
    const initial: Record<string, Fact> = {};
    for (const fact of initialContext?.facts ?? []) {
      if (fact.kind === "season_peak" && fact.platformSeasonKey) initial[fact.platformSeasonKey] = { rank: fact.rank, rating: fact.rating, stars: fact.stars === null ? "" : String(fact.stars) };
    }
    return initial;
  });
  // Facts as loaded from the server. A pre-stars fact (stars === null) that the
  // participant did not touch passes through saves unchanged instead of being
  // blocked or silently filled with a guessed star count.
  const [initialFacts, setInitialFacts] = useState<Record<string, InitialFact>>(() => collectInitialFacts(initialContext));

  const catalogIncomplete = Boolean(
    !context || context.ladder.length === 0 || !context.seasons.some((season) => season.isCurrent) ||
    !context.seasons.some((season) => season.isPrevious),
  );

  const seasonFields = useMemo(() => context?.seasons ?? [], [context]);

  function choosePlatform(nextPlatform: string) {
    const next = contexts.find((item) => item.platform === nextPlatform);
    setPlatform(nextPlatform);
    setSaved(false);
    const historicalFact = next?.facts.find((item) => item.kind === "historical_peak" && item.platformSeasonKey === null);
    setHistorical(historicalFact ? { rank: historicalFact.rank, rating: historicalFact.rating, stars: historicalFact.stars === null ? "" : String(historicalFact.stars) } : { rank: "", rating: "", stars: "" });
    const nextFacts: Record<string, Fact> = {};
    for (const fact of next?.facts ?? []) {
      if (fact.kind === "season_peak" && fact.platformSeasonKey) nextFacts[fact.platformSeasonKey] = { rank: fact.rank, rating: fact.rating, stars: fact.stars === null ? "" : String(fact.stars) };
    }
    setSeasonFacts(nextFacts);
    setInitialFacts(collectInitialFacts(next));
  }

  const platformSelect = contexts.length > 1 && <div className="space-y-1.5"><Label>竞技平台</Label><Select value={platform} onValueChange={choosePlatform}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{contexts.map((item) => <SelectItem key={item.platform} value={item.platform}>{item.platformDisplayName}</SelectItem>)}</SelectContent></Select></div>;

  if (catalogIncomplete) {
    return <Panel label="竞技档案" pad={20}><div className="space-y-5">{platformSelect}<StatusBanner tone="warn" title="当前竞技平台目录尚未完善" sub="管理员需要配置当前赛季、上一赛季和平台段位表后，才可提交该平台用于资格审核的竞技资料；你仍可切换到其他已完善的平台。" /></div></Panel>;
  }

  const context_ = context!;
  const ladder = [...context_.ladder];
  // A long-lived fact whose rank key is no longer on the ladder stays visible
  // instead of silently disappearing from its select.
  for (const fact of context_.facts) {
    if (fact.rank && !ladder.some((entry) => entry.rankKey === fact.rank)) ladder.push({ rankKey: fact.rank, label: fact.rank, starMin: null, starMax: null });
  }
  const ladderFor = (rank: string) => (rank && !ladder.some((entry) => entry.rankKey === rank) ? [...ladder, { rankKey: rank, label: rank, starMin: null, starMax: null }] : ladder);

  // A loaded fact whose stored stars are null counts as untouched legacy only
  // while rank and rating stay exactly as loaded; any real edit requires stars.
  const isUntouchedLegacy = (key: string, fact: Fact) => {
    const initial = initialFacts[key];
    return Boolean(initial && initial.stars === null && fact.rank !== "" && fact.rank === initial.rank && Number(fact.rating) === Number(initial.rating));
  };

  const currentSeason = seasonFields.find((season) => season.isCurrent);
  const filledSeasonPeaks = seasonFields
    .map((season) => ({ season, fact: seasonFacts[season.seasonKey] ?? { rank: "", rating: "", stars: "" } }))
    .filter(({ fact }) => fact.rank.trim() !== "" || fact.rating.trim() !== "" || fact.stars.trim() !== "");

  const field = (title: string, fact: Fact, setFact: (fact: Fact) => void, hint: string, key?: string) => {
    const selectedRank = ladderFor(fact.rank).find((entry) => entry.rankKey === fact.rank);
    const starMin = selectedRank?.starMin ?? null;
    const starMax = selectedRank?.starMax ?? null;
    const hasStars = starMin !== null;
    const starRange = hasStars ? (starMax === null ? `${starMin}+` : `${starMin}–${starMax}`) : null;
    const legacyPending = hasStars && key !== undefined && isUntouchedLegacy(key, fact);
    return (
    <section key={key} className="space-y-3 border-l-2 border-[var(--color-border-hi)] pl-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-mid)]">{hint}</p>
      </div>
      <div className={`grid gap-3 ${hasStars ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="space-y-1.5">
          <Label>段位</Label>
          <Select value={fact.rank || undefined} onValueChange={(rankKey) => {
            const nextRank = ladderFor(rankKey).find((entry) => entry.rankKey === rankKey);
            const currentStars = Number(fact.stars);
            const keepStars = nextRank?.starMin !== null && nextRank?.starMin !== undefined && fact.stars.trim() !== "" && Number.isInteger(currentStars) && currentStars >= nextRank.starMin && (nextRank.starMax === null || currentStars <= nextRank.starMax);
            setSaved(false);
            setFact({ ...fact, rank: rankKey, stars: keepStars ? fact.stars : "" });
          }}>
            <SelectTrigger><SelectValue placeholder="选择最高段位" /></SelectTrigger>
            <SelectContent>{ladderFor(fact.rank).map((entry) => <SelectItem key={entry.rankKey} value={entry.rankKey}>{entry.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`rating-${key}`}>对应 {context?.ratingLabel ?? "Rating"}</Label>
          <Input id={`rating-${key}`} value={fact.rating} onChange={(event) => { setSaved(false); setFact({ ...fact, rating: event.target.value }); }} inputMode="decimal" placeholder={`可填写对应 ${context?.ratingLabel ?? "Rating"}`} />
        </div>
        {hasStars && <div className="space-y-1.5">
          <Label htmlFor={`stars-${key}`}>星数</Label>
          <Input id={`stars-${key}`} value={fact.stars} onChange={(event) => { setSaved(false); setFact({ ...fact, stars: event.target.value }); }} inputMode="numeric" type="number" min={starMin ?? undefined} max={starMax ?? undefined} step={1} placeholder={legacyPending ? `星数待补充：${starRange}` : `星数：${starRange}`} />
          <p className="font-mono text-[11px] text-[var(--color-fg-mid)]">{legacyPending ? "历史资料未记录星数；保持段位与 Rating 不变可直接保存，修改后需补填。" : `星数：${starRange}`}</p>
        </div>}
      </div>
    </section>
    );
  };

  return <Panel label="竞技档案" pad={20}>
    <div className="space-y-5">
      {platformSelect}
      <StatusBanner tone="info" title={`${context_.platformDisplayName} · 赛季资料`} sub={currentSeason ? `当前赛季：${currentSeason.label}。也可补充历史赛季资料，供按该届规则核验的赛事使用。` : "请如实自行申报。"} />
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">系统依照平台段位表（由低到高）核验资料；{context_.ratingLabel} 是该平台官方竞技评分，仅在赛事规则指定的同分比较中使用。未公布的跨平台换算不会由此页面推断。</p>
      {field("历史最高", historical, setHistorical, "不限定平台赛季，填写个人历史最高纪录", HISTORICAL_KEY)}
      {seasonFields.map((season) => field(
        `${season.isCurrent ? "当前赛季" : season.isPrevious ? "上一赛季" : "历史赛季"} · ${season.label}`,
        seasonFacts[season.seasonKey] ?? { rank: "", rating: "", stars: "" },
        (fact) => { setSaved(false); setSeasonFacts((current) => ({ ...current, [season.seasonKey]: fact })); },
        `平台赛季 ${season.label}（可留空）`,
        season.seasonKey,
      ))}
      {saved && <StatusBanner tone="success" title="竞技档案已保存" sub="报名和赛务审核会使用你最新保存的资料。" />}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => {
          const missingRequired = (key: string, fact: Fact) => {
            const rank = ladderFor(fact.rank).find((entry) => entry.rankKey === fact.rank);
            const starsMissing = rank?.starMin !== null && rank?.starMin !== undefined && fact.stars.trim() === "" && !isUntouchedLegacy(key, fact);
            return fact.rank.trim() === "" || fact.rating.trim() === "" || starsMissing;
          };
          const partial = filledSeasonPeaks.find(({ season, fact }) => missingRequired(season.seasonKey, fact));
          if (partial) { toast.error(`「${partial.season.label}」需要填写段位、Rating${ladderFor(partial.fact.rank).find((entry) => entry.rankKey === partial.fact.rank)?.starMin != null ? "与星数" : ""}，或整项留空。`); return; }
          if (missingRequired(HISTORICAL_KEY, historical)) { toast.error("历史最高需要填写段位、Rating，以及所选段位要求的星数。"); return; }
          const payload = {
            platform: context_.platform,
            historicalPeak: { ...historical, stars: historical.stars.trim() === "" ? null : Number(historical.stars) },
            seasonPeaks: filledSeasonPeaks.map(({ season, fact }) => ({ seasonKey: season.seasonKey, rank: fact.rank, rating: fact.rating, stars: fact.stars.trim() === "" ? null : Number(fact.stars) })),
          };
          startTransition(async () => {
            const result = await saveCompetitiveProfile(payload);
            if (result.success) {
              setSaved(true);
              const nextInitial: Record<string, InitialFact> = {
                [HISTORICAL_KEY]: { rank: historical.rank, rating: historical.rating, stars: payload.historicalPeak.stars },
              };
              for (const peak of payload.seasonPeaks) nextInitial[peak.seasonKey] = { rank: peak.rank, rating: peak.rating, stars: peak.stars };
              setInitialFacts(nextInitial);
              toast.success("竞技档案已保存");
            } else toast.error(result.error.message);
          });
        }}>{pending ? "保存中…" : "保存竞技档案"}</Button>
        <span className="font-mono text-[11px] text-[var(--color-fg-mid)]">段位与 Rating 可稍后补充；报名时将说明缺失项。</span>
      </div>
    </div>
  </Panel>;
}
