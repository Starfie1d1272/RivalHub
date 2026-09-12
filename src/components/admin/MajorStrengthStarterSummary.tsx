"use client";

import { isBuiltInStarRank } from "@/lib/competitive/builtins";
import { presentCompetitiveRankSummary } from "@/lib/competitive/presentation";
import type { MajorStrengthFact, MajorStrengthStarter } from "@/lib/admin/season-workspace/types";

export function sourceLabel(platform: string | null): string {
  if (platform === "fivee") return "5E";
  if (platform === "perfect_world") return "完美平台";
  return platform ?? "未知来源";
}

function formatStrengthFact(fact: MajorStrengthFact | null, platform: string | null): string {
  if (!fact) return "暂无";
  return presentCompetitiveRankSummary(fact.rank, fact.stars, isBuiltInStarRank(platform ?? "perfect_world", fact.rank));
}

function isConverted(fact: MajorStrengthFact | null): fact is MajorStrengthFact {
  return fact?.sourcePlatform === "fivee" && Boolean(fact.sourceRank);
}

function ProvenanceBadge({ fact }: { fact: MajorStrengthFact | null }) {
  if (!isConverted(fact)) return null;
  return <span className="inline-flex shrink-0 whitespace-nowrap rounded border border-[var(--color-accent)] px-1 py-0.5 text-[10px] text-[var(--color-accent)]">采用 5E 等效</span>;
}

function FactLine({ label, fact, platform }: { label: string; fact: MajorStrengthFact | null; platform: string | null }) {
  return <p>{label}：{formatStrengthFact(fact, platform)} <ProvenanceBadge fact={fact} /></p>;
}

export function MajorStrengthStarterSummary({
  starter,
  platform,
  recentLabel = "近期实际参考",
  showProvenance = false,
}: {
  starter: MajorStrengthStarter;
  platform: string | null;
  recentLabel?: string;
  showProvenance?: boolean;
}) {
  const provenanceFacts = [
    starter.historicalPeak,
    starter.previousSeasonPeak,
    starter.currentSeasonPeak,
    ...starter.recentSeasonPeaks,
    starter.effectiveRecentPeak,
  ]
    .filter(isConverted)
    .filter((fact, index, facts) => facts.findIndex((other) =>
      other.rank === fact.rank &&
      other.sourcePlatform === fact.sourcePlatform &&
      other.sourceSeasonKey === fact.sourceSeasonKey &&
      other.sourceRank === fact.sourceRank &&
      other.sourceStars === fact.sourceStars &&
      other.conversionVersion === fact.conversionVersion,
    ) === index);

  return (
    <details className="border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-1.5">
      <summary className="cursor-pointer list-none text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-[var(--color-fg)]">{starter.label}</span>
          <span className="font-mono text-[var(--color-fg-mid)]">历史 {formatStrengthFact(starter.historicalPeak, platform)}</span>
          <span className="font-mono text-[var(--color-fg-mid)]">综合 {starter.breakdown.weightedRank === null ? "无法计算" : starter.breakdown.weightedRank.toFixed(2)}</span>
          <span className="font-mono text-[var(--color-fg-mid)]">近期 {formatStrengthFact(starter.effectiveRecentPeak, platform)}</span>
          <ProvenanceBadge fact={starter.historicalPeak} />
          <ProvenanceBadge fact={starter.effectiveRecentPeak} />
        </span>
      </summary>
      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2 text-[11px] leading-5 text-[var(--color-fg-mid)]">
        <FactLine label="历史最高" fact={starter.historicalPeak} platform={platform} />
        <FactLine label="前一完整赛季" fact={starter.previousSeasonPeak} platform={platform} />
        <FactLine label="当前赛季候选" fact={starter.currentSeasonPeak} platform={platform} />
        <FactLine label={recentLabel} fact={starter.effectiveRecentPeak} platform={platform} />
        <p>
          综合参考值 {starter.breakdown.weightedRank === null ? "无法计算" : starter.breakdown.weightedRank.toFixed(2)}
          {starter.breakdown.historicalValue === null || starter.breakdown.previousValue === null || starter.breakdown.currentValue === null
            ? ""
            : ` · 历史/前一赛季/近期参考 ${starter.breakdown.historicalValue}/${starter.breakdown.previousValue}/${starter.breakdown.currentValue}`}
          {starter.breakdown.historicalRating === null ? "" : ` · 历史 Rating ${starter.breakdown.historicalRating}`}
        </p>
        {showProvenance && provenanceFacts.map((fact, index) => (
          <p key={`${starter.userId}-source-${index}`}>
            来源：{sourceLabel(fact.sourcePlatform)}{fact.sourceSeasonKey ? ` · 赛季 ${fact.sourceSeasonKey}` : ""} · 原始 {fact.sourceRank}{fact.sourceStars === null ? "" : ` · ${fact.sourceStars} 星`} · 换算版本 {fact.conversionVersion ?? "未记录"}
          </p>
        ))}
        {!starter.breakdown.available && <ul className="list-disc pl-4 text-[var(--color-warn)]">
          {starter.breakdown.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>}
      </div>
    </details>
  );
}
