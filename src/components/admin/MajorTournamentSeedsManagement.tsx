"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmMajorTournamentSeeds, saveMajorTournamentSeeds } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isBuiltInStarRank } from "@/lib/competitive/builtins";
import { presentCompetitiveRankSummary } from "@/lib/competitive/presentation";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";
import { Marker, Panel } from "@/components/rivalhub";

export type MajorTournamentSeedsManagementData = MajorPrestartPageData["seedManagement"];

type RecommendationStarter = NonNullable<MajorTournamentSeedsManagementData["recommendation"]>["teams"][number]["starters"][number];
type RecommendationFact = RecommendationStarter["currentSeasonPeak"];

function sourceLabel(platform: string | null): string {
  if (platform === "fivee") return "5E";
  if (platform === "perfect_world") return "完美平台";
  return platform ?? "未知来源";
}

function formatFact(fact: RecommendationFact, platform: string): string {
  if (!fact) return "暂无";
  return presentCompetitiveRankSummary(fact.rank, fact.stars, isBuiltInStarRank(platform, fact.rank));
}

function isConverted(fact: RecommendationFact): boolean {
  return fact?.sourcePlatform === "fivee" && Boolean(fact.sourceRank);
}

const FINAL_ORDER_STATUS_LABEL: Record<NonNullable<MajorTournamentSeedsManagementData["recommendation"]>["teams"][number]["finalOrderStatus"], string> = {
  aligned: "与系统一致",
  tie_resolved: "系统并列 · 人工定序",
  adjusted: "人工调整",
  unsaved: "未保存",
};

function FactLine({ label, fact, platform }: { label: string; fact: RecommendationFact; platform: string }) {
  return <p>{label}：{formatFact(fact, platform)} {isConverted(fact) && <span className="ml-1 rounded border border-[var(--color-accent)] px-1 py-0.5 text-[10px] text-[var(--color-accent)]">5E 换算</span>}</p>;
}

function StarterSummary({ starter, platform }: { starter: RecommendationStarter; platform: string }) {
  const primaryFact = starter.effectiveRecentPeak ?? starter.currentSeasonPeak ?? starter.previousSeasonPeak ?? starter.historicalPeak;
  const provenanceFacts = [
    starter.historicalPeak,
    starter.previousSeasonPeak,
    starter.currentSeasonPeak,
    starter.effectiveRecentPeak,
  ]
    .filter((fact): fact is NonNullable<RecommendationFact> => isConverted(fact))
    .filter((fact, index, facts) => facts.findIndex((other) =>
      other.rank === fact.rank &&
      other.sourceSeasonKey === fact.sourceSeasonKey &&
      other.sourceRank === fact.sourceRank &&
      other.sourceStars === fact.sourceStars &&
      other.conversionVersion === fact.conversionVersion,
    ) === index);
  return (
    <details className="border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-1.5">
      <summary className="cursor-pointer list-none text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
        <span className="font-medium text-[var(--color-fg)]">{starter.label}</span>
        <span className="ml-2 font-mono text-[var(--color-fg-mid)]">{formatFact(primaryFact, platform)}</span>
        {isConverted(primaryFact) && <span className="ml-2 rounded border border-[var(--color-accent)] px-1 py-0.5 text-[10px] text-[var(--color-accent)]">5E 换算</span>}
      </summary>
      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2 text-[11px] leading-5 text-[var(--color-fg-mid)]">
        <FactLine label="历史最高" fact={starter.historicalPeak} platform={platform} />
        <FactLine label="前一完整赛季" fact={starter.previousSeasonPeak} platform={platform} />
        <FactLine label="当前赛季候选" fact={starter.currentSeasonPeak} platform={platform} />
        <FactLine label="近期（实际参与 30%）" fact={starter.effectiveRecentPeak} platform={platform} />
        <p>weightedRank {starter.breakdown.weightedRank.toFixed(2)} · 段位值 {starter.breakdown.historicalValue}/{starter.breakdown.previousValue}/{starter.breakdown.currentValue}{starter.breakdown.historicalRating === null ? "" : ` · 历史 Rating ${starter.breakdown.historicalRating}`}</p>
        {provenanceFacts.map((fact, index) => (
          <p key={`${starter.userId}-source-${index}`}>
            来源：{sourceLabel(fact.sourcePlatform)}{fact.sourceSeasonKey ? ` · 赛季 ${fact.sourceSeasonKey}` : ""} · 原始 {fact.sourceRank}{fact.sourceStars === null ? "" : ` · ${fact.sourceStars} 星`} · conversion {fact.conversionVersion ?? "未记录"}
          </p>
        ))}
      </div>
    </details>
  );
}

export function MajorTournamentSeedsManagement({ data }: { data: MajorTournamentSeedsManagementData }) {
  const [isPending, startTransition] = useTransition();
  const capacity = data.entrants.length;
  const saved = [...data.seeds].sort((a, b) => a.tournamentSeed - b.tournamentSeed).map((seed) => seed.teamId);
  const recommendationOrder = data.recommendation?.teams
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((team) => team.teamId) ?? [];
  const initialOrder = saved.length === capacity
    ? saved
    : recommendationOrder.length === capacity
      ? recommendationOrder
      : data.entrants.map((entrant) => entrant.teamId);
  const initialOrderKey = initialOrder.join(",");
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [overrideReason, setOverrideReason] = useState(data.overrideReason ?? "");
  const [viewSort, setViewSort] = useState<"recommendation" | "strength">("recommendation");

  useEffect(() => setOrder(initialOrderKey ? initialOrderKey.split(",") : []), [initialOrderKey]);
  useEffect(() => setOverrideReason(data.overrideReason ?? ""), [data.overrideReason]);

  const teamById = useMemo(() => new Map(data.entrants.map((entrant) => [entrant.teamId, entrant])), [data.entrants]);
  const recommendation = data.recommendation;
  const analysisRows = useMemo(() => {
    const rows = [...(recommendation?.teams ?? [])];
    if (viewSort === "strength") rows.sort((left, right) => right.teamSeedStrengthScaled - left.teamSeedStrengthScaled || left.displayOrder - right.displayOrder);
    else rows.sort((left, right) => left.displayOrder - right.displayOrder);
    return rows;
  }, [recommendation, viewSort]);
  const tieGroupSizes = useMemo(() => {
    const sizes = new Map<number, number>();
    for (const team of recommendation?.teams ?? []) {
      sizes.set(team.tieGroup, (sizes.get(team.tieGroup) ?? 0) + 1);
    }
    return sizes;
  }, [recommendation]);
  const confirmed = data.seedsConfirmed;
  const orderMatchesSaved = order.length === saved.length && order.every((teamId, index) => teamId === saved[index]);
  const move = (index: number, offset: -1 | 1) => setOrder((current) => {
    const next = index + offset;
    if (next < 0 || next >= current.length) return current;
    const copy = [...current];
    [copy[index], copy[next]] = [copy[next]!, copy[index]!];
    return copy;
  });

  const save = () => startTransition(async () => {
    const result = await saveMajorTournamentSeeds({
      seasonId: data.seasonId,
      entryIds: order,
      overrideReason: overrideReason.trim() || undefined,
    });
    if (!result.success) toast.error(result.error.message);
    else toast.success("最终种子已保存，需重新确认");
  });

  return (
    <Panel label="赛事 1–32 种子">
      {!data.entrantsLocked ? <p className="text-sm text-[var(--color-fg-mid)]">请先锁定正式参赛队和最终赛事名单，种子才能保存。</p> : <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Marker sub={confirmed ? "当前排序已确认" : data.seeds.length > 0 ? "排序已变更，需要重新确认" : "尚未保存排序"}>{confirmed ? "种子已确认" : "种子待确认"}</Marker>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">系统建议是 immutable snapshot；下面的最终排序是管理员人工事实。查看分析表的排序不会改变最终种子。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={isPending || order.length !== capacity} onClick={save}>保存排序</Button>
            <Button disabled={isPending || confirmed || data.seeds.length !== capacity || !orderMatchesSaved} onClick={() => startTransition(async () => {
              const result = await confirmMajorTournamentSeeds({ seasonId: data.seasonId });
              if (!result.success) toast.error(result.error.message); else toast.success("赛事种子已确认");
            })}>确认种子</Button>
          </div>
        </div>

        {data.recommendationStatus !== "ready" && <p className="border border-[var(--color-warn)] px-3 py-2 text-sm text-[var(--color-warn)]">
          {data.recommendationStatus === "missing" ? "统一冻结完成后才会生成系统种子建议。" : "系统种子建议与当前冻结事实不一致，已停止用于最终种子。"}
        </p>}

        {data.recommendation && <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h3 className="font-medium text-[var(--color-fg)]">系统种子分析表</h3><p className="mt-1 text-xs text-[var(--color-fg-mid)]">快照 v{data.recommendation.version} · {sourceLabel(data.recommendation.platform)} · ConversionPolicy {data.recommendation.conversionPolicyId ?? "未指定"} / {data.recommendation.conversionPolicyVersion ?? "未指定版本"} · 生成于 {data.recommendation.generatedAt}</p></div>
            <div className="flex gap-2" aria-label="分析表查看排序">
              <Button type="button" size="sm" variant={viewSort === "recommendation" ? "default" : "outline"} onClick={() => setViewSort("recommendation")}>按系统建议</Button>
              <Button type="button" size="sm" variant={viewSort === "strength" ? "default" : "outline"} onClick={() => setViewSort("strength")}>按参考值排序</Button>
            </div>
          </div>
          <div className="overflow-x-auto border border-[var(--color-border)]">
            <table className="min-w-[1160px] w-full text-left text-xs">
              <thead className="bg-[var(--color-panel-low)] text-[var(--color-fg-mid)]"><tr><th className="px-3 py-2">系统建议</th><th className="px-3 py-2">TeamSeedStrength</th><th className="px-3 py-2">最终 seed / 调整状态</th><th className="px-3 py-2">5 名 frozen primary starters · 竞技资料</th></tr></thead>
              <tbody>{analysisRows.map((team) => <tr key={team.teamId} className="border-t border-[var(--color-border)] align-top"><td className="w-36 px-3 py-3"><p className="font-medium text-[var(--color-fg)]">#{team.recommendationRank} · {team.teamName}</p><p className="mt-1 text-[var(--color-fg-mid)]">{(tieGroupSizes.get(team.tieGroup) ?? 0) > 1 ? `系统并列 · 组 ${team.tieGroup}` : "无系统并列"}</p></td><td className="w-32 px-3 py-3 font-mono text-[var(--color-fg)]">{team.teamSeedStrength.toFixed(2)}</td><td className="w-28 px-3 py-3 font-mono text-[var(--color-fg)]">{team.finalSeed === null ? "未保存" : `#${team.finalSeed}`}<p className="mt-1 font-sans text-[11px] text-[var(--color-fg-mid)]">{FINAL_ORDER_STATUS_LABEL[team.finalOrderStatus]}</p></td><td className="px-3 py-3"><div className="grid gap-2 md:grid-cols-5">{team.starters.map((starter) => <StarterSummary key={starter.userId} starter={starter} platform={data.recommendation!.platform} />)}</div></td></tr>)}</tbody>
            </table>
          </div>
        </section>}

        <section>
          <h3 className="font-medium text-[var(--color-fg)]">最终人工 seed 顺序</h3>
          <ol className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{order.map((teamId, index) => <li key={teamId} className="flex items-center gap-2 border border-[var(--color-border)] px-2 py-1.5 text-sm"><span className="w-8 font-mono text-[var(--color-fg-mid)]">#{index + 1}</span><span className="min-w-0 flex-1 truncate">{teamById.get(teamId)?.teamName ?? teamId}</span><div className="flex gap-1"><Button type="button" size="sm" variant="ghost" disabled={isPending || index === 0} onClick={() => move(index, -1)}>↑</Button><Button type="button" size="sm" variant="ghost" disabled={isPending || index === order.length - 1} onClick={() => move(index, 1)}>↓</Button></div></li>)}</ol>
        </section>

        <label className="block space-y-2 text-sm"><span className="font-medium text-[var(--color-fg)]">人工调整原因（偏离系统建议时必填；系统并列内部顺序可选填）</span><Textarea value={overrideReason} maxLength={500} onChange={(event) => setOverrideReason(event.target.value)} placeholder="例如：组内并列，依据赛委会人工复核顺序确定。" disabled={isPending} /><span className="text-xs text-[var(--color-fg-mid)]">保存后会持久化到赛前状态，并写入 audit；不会修改 immutable 系统快照。</span></label>

        {data.seeds.length === capacity ? <div className="grid gap-3 lg:grid-cols-3">
          <SeedCohort label="Stage 3 · #1–8" seeds={data.seeds.filter((seed) => seed.tournamentSeed <= 8)} teams={teamById} />
          <SeedCohort label="Stage 2 · #9–16" seeds={data.seeds.filter((seed) => seed.tournamentSeed >= 9 && seed.tournamentSeed <= 16)} teams={teamById} />
          <SeedCohort label="Stage 1 · #17–32" seeds={data.seeds.filter((seed) => seed.tournamentSeed >= 17)} teams={teamById} />
        </div> : <p className="text-sm text-[var(--color-fg-mid)]">保存后将按 Stage 3 #1–8、Stage 2 #9–16、Stage 1 #17–32 展示入场批次。</p>}

        <section><h3 className="font-medium text-[var(--color-fg)]">第一轮预览</h3>{data.firstRound ? <ol className="mt-2 grid gap-2 text-sm md:grid-cols-2">{data.firstRound.map((pairing) => <li key={`${pairing.higherSeed}-${pairing.lowerSeed}`} className="border border-[var(--color-border)] px-3 py-2">#{pairing.higherSeed} {teamById.get(data.seeds.find((seed) => seed.tournamentSeed === pairing.higherSeed)?.teamId ?? "")?.teamName} vs #{pairing.lowerSeed} {teamById.get(data.seeds.find((seed) => seed.tournamentSeed === pairing.lowerSeed)?.teamId ?? "")?.teamName} · {pairing.format.toUpperCase()}</li>)}</ol> : <p className="mt-1 text-sm text-[var(--color-fg-mid)]">需先保存完整种子才能构造预览。</p>}<p className="mt-2 text-sm text-[var(--color-fg-mid)]">这是保存前的对阵预览；保存种子前不会创建比赛。</p></section>
      </div>}
    </Panel>
  );
}

function SeedCohort({ label, seeds, teams }: { label: string; seeds: MajorTournamentSeedsManagementData["seeds"]; teams: Map<string, { teamId: string; teamName: string }> }) {
  return <section className="border border-[var(--color-border)] p-3"><h3 className="font-medium text-[var(--color-fg)]">{label}</h3><ol className="mt-2 space-y-1 text-sm text-[var(--color-fg-mid)]">{[...seeds].sort((a, b) => a.tournamentSeed - b.tournamentSeed).map((seed) => <li key={seed.teamId}>#{seed.tournamentSeed} {teams.get(seed.teamId)?.teamName}</li>)}</ol></section>;
}
