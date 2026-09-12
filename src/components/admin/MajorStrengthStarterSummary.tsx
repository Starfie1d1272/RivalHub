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
  const { presentation } = starter;
  const provenanceFacts = [
    { label: "历史最高", fact: presentation.historicalPeak },
    { label: "参考", fact: presentation.referenceSeasonPeak },
    { label: recentLabel, fact: presentation.recentPeak },
    { label: "当前赛季候选", fact: presentation.currentSeasonPeak },
  ]
    .filter((item): item is { label: string; fact: MajorStrengthFact } => isConverted(item.fact))
    .filter((item, index, items) => items.findIndex((other) =>
      other.fact.rank === item.fact.rank &&
      other.fact.sourcePlatform === item.fact.sourcePlatform &&
      other.fact.sourceSeasonKey === item.fact.sourceSeasonKey &&
      other.fact.sourceRank === item.fact.sourceRank &&
      other.fact.sourceStars === item.fact.sourceStars &&
      other.fact.conversionVersion === item.fact.conversionVersion,
    ) === index);

  return (
    <details className="border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-1.5">
      <summary className="cursor-pointer list-none text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-[var(--color-fg)]">{starter.label}</span>
          <span className="font-mono text-[var(--color-fg-mid)]">历史 {formatStrengthFact(presentation.historicalPeak, platform)}</span>
          <span className="font-mono text-[var(--color-fg-mid)]">参考 {formatStrengthFact(presentation.referenceSeasonPeak, platform)}</span>
          <span className="font-mono text-[var(--color-fg-mid)]">近期 {formatStrengthFact(presentation.recentPeak, platform)}</span>
          <ProvenanceBadge fact={presentation.historicalPeak} />
          <ProvenanceBadge fact={presentation.referenceSeasonPeak} />
          <ProvenanceBadge fact={presentation.recentPeak} />
        </span>
      </summary>
      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2 text-[11px] leading-5 text-[var(--color-fg-mid)]">
        <FactLine label="历史最高" fact={presentation.historicalPeak} platform={platform} />
        <FactLine label="前一完整赛季" fact={presentation.referenceSeasonPeak} platform={platform} />
        <FactLine label="当前赛季候选" fact={presentation.currentSeasonPeak} platform={platform} />
        <FactLine label={recentLabel} fact={presentation.recentPeak} platform={platform} />
        {presentation.historicalRating !== null && <p>历史 Rating {presentation.historicalRating}</p>}
        {showProvenance && provenanceFacts.map(({ label, fact }, index) => (
          <p key={`${starter.userId}-source-${index}`}>
            来源（{label}）：{sourceLabel(fact.sourcePlatform)}{fact.sourceSeasonKey ? ` · 赛季 ${fact.sourceSeasonKey}` : ""} · 原始 {fact.sourceRank}{fact.sourceStars === null ? "" : ` · ${fact.sourceStars} 星`} · 换算版本 {fact.conversionVersion ?? "未记录"}
          </p>
        ))}
        {!presentation.available && <ul className="list-disc pl-4 text-[var(--color-warn)]">
          {presentation.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>}
      </div>
    </details>
  );
}
