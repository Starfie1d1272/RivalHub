"use client";

import React from "react";

import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { StatsTooltip } from "@/components/stats/StatsTooltip";
import { formatDisplayValue } from "@/lib/stats/display";
import { STATS_METRICS } from "@/lib/stats/metrics";
import type {
  PlayerAttributeMetricProjection,
  PlayerAttributeProfile,
  PlayerAttributeProjection,
} from "@/lib/stats/player-attributes";

function scoreWidth(score: number | null) {
  return score == null ? "0%" : `${Math.max(0, Math.min(100, score))}%`;
}

const profileHelp = (
  <div className="space-y-2">
    <p>打法画像把当前统计范围内的选手数据放到 RivalHub 全站历史基准中比较。每个基础指标的 0–100 分本质上是它在合格历史样本中的百分位位置：分数越高，表示该特征在历史样本中越突出；对于 Entrying、Sniping 等打法维度，高分不等同于更强。</p>
    <p>正式比较前，每个指标会先计算动态样本线：取该指标有效样本量的 P75，再乘 25% 并向上取整。低于这条线的结果标记为 Limited，仍可显示相对分，但不进入正式排名。</p>
    <p>各 Attribute 再按问号中列出的公式，对参与计算的基础指标相对分加权合成 0–100 总分；展开后的其他指标用于解释画像，不会改变总分。</p>
  </div>
);

function detailLabel(metric: PlayerAttributeMetricProjection) {
  if (metric.key === "clutch1v1") return "1v1%";
  if (metric.key === "clutch1v2") return "1v2%";
  if (metric.key === "clutch1v3") return "1v3%";
  return STATS_METRICS[metric.metric].label;
}

function limitedExplanation(attribute: PlayerAttributeProjection) {
  const limited = attribute.metrics.filter((metric) => metric.weight != null && metric.status === "limited");

  return (
    <div className="space-y-2">
      <p>
        参与 {attribute.label} 总分计算的部分指标样本低于当前全站正式资格线
        （对应指标有效样本 P75 × 25%）。
      </p>
      {limited.length > 0 && (
        <div className="space-y-1 text-[var(--color-fg-mid)]">
          {limited.map((metric) => {
            const meta = STATS_METRICS[metric.metric];
            return (
              <p key={metric.key}>
                {detailLabel(metric)}：{metric.sample ?? 0} / 最低 {metric.floor ?? "—"} {meta.rankingSampleLabel ?? meta.sampleLabel}
              </p>
            );
          })}
        </div>
      )}
      <p>仍使用同一全站历史基准计算 0–100 分，但不进入正式排名；小样本下分数波动可能更大。</p>
    </div>
  );
}

function metricLimitedExplanation(metric: PlayerAttributeMetricProjection) {
  const meta = STATS_METRICS[metric.metric];

  return (
    <div className="space-y-2">
      <p>
        当前只有 {metric.sample ?? 0} {meta.rankingSampleLabel ?? meta.sampleLabel}，
        低于正式评分样本线 {metric.floor ?? "—"}。
      </p>
      <p>该指标仍按同一全站历史基准得到相对分，但不会参与正式排名，结果可能受小样本波动影响。</p>
    </div>
  );
}

function AttributeHelp({ attribute }: { attribute: PlayerAttributeProjection }) {
  return (
    <StatsTooltip
      label={`${attribute.label} 说明`}
      content={(
        <div className="space-y-2">
          <p>{attribute.description}</p>
          <p className="text-[var(--color-fg-mid)]">
            <span className="font-medium text-[var(--color-fg)]">评分公式：</span>
            {attribute.formula}
          </p>
        </div>
      )}
    />
  );
}

function LimitedTag({ attribute }: { attribute: PlayerAttributeProjection }) {
  if (attribute.status !== "limited") return null;

  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-sm border border-[var(--color-border-hi)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-fg-mid)]">
        Limited
      </span>
      <StatsTooltip label={`${attribute.label} 样本受限说明`} content={limitedExplanation(attribute)} />
    </span>
  );
}

function MetricRow({ metric }: { metric: PlayerAttributeMetricProjection }) {
  const meta = STATS_METRICS[metric.metric];
  const label = detailLabel(metric);

  return (
    <div className="border-t border-[var(--color-border)] py-2 first:border-t-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--color-fg-mid)]">
          <StatsMetricLabel metric={metric.metric}>{label}</StatsMetricLabel>
          {metric.status === "limited" && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className="rounded-sm border border-[var(--color-border-hi)] px-1 py-0.5 text-[9px] font-medium leading-none text-[var(--color-fg-dim)]">
                Limited
              </span>
              <StatsTooltip
                label={`${label} 样本受限说明`}
                content={metricLimitedExplanation(metric)}
              />
            </span>
          )}
        </div>

        <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-fg)]">
          {formatDisplayValue(metric.value, meta)}
        </span>
      </div>

      <div
        className="mt-1.5 h-1 overflow-hidden bg-[var(--color-border)]"
        aria-label={metric.score == null ? `${label} 暂无相对分` : `${label} 相对分 ${metric.score}/100`}
      >
        <div
          className="h-full bg-[var(--color-accent)] transition-[width]"
          style={{ width: scoreWidth(metric.score) }}
        />
      </div>
    </div>
  );
}

function AttributeCard({
  attribute,
  wide = false,
}: {
  attribute: PlayerAttributeProjection;
  wide?: boolean;
}) {
  const ranking = attribute.status === "qualified" && attribute.rank != null
    ? `#${attribute.rank} / ${attribute.rankedCount}`
    : null;

  return (
    <details className="group rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)]">
      <summary className="cursor-pointer list-none px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-base font-semibold text-[var(--color-fg)]">{attribute.label}</span>
            <AttributeHelp attribute={attribute} />
            <LimitedTag attribute={attribute} />
          </div>

          <div className="flex shrink-0 items-baseline gap-1">
            <span className="text-lg font-semibold tabular-nums text-[var(--color-fg)]">
              {attribute.score ?? "—"}
            </span>
            {attribute.score != null && <span className="text-xs text-[var(--color-fg-dim)]">/100</span>}
            <span className="ml-1 text-xs text-[var(--color-fg-dim)] transition-transform group-open:rotate-180">▼</span>
          </div>
        </div>

        {ranking && <p className="mt-1 text-[10px] text-[var(--color-fg-dim)]">{ranking}</p>}

        <div className="mt-2 h-1.5 overflow-hidden bg-[var(--color-border)]">
          <div
            className="h-full bg-[var(--color-accent)] transition-[width]"
            style={{ width: scoreWidth(attribute.score) }}
          />
        </div>
      </summary>

      <div className={wide ? "grid border-t border-[var(--color-border)] px-3.5 pb-0.5 sm:grid-cols-2 sm:gap-x-6" : "border-t border-[var(--color-border)] px-3.5 pb-0.5"}>
        {attribute.metrics.map((metric) => <MetricRow key={metric.key} metric={metric} />)}
      </div>
    </details>
  );
}

export function PlayerAttributes({ profile }: { profile: PlayerAttributeProfile }) {
  const firepower = profile.attributes.find((attribute) => attribute.key === "firepower");
  const others = profile.attributes.filter((attribute) => attribute.key !== "firepower");

  return (
    <section className="space-y-3" aria-labelledby="player-attributes-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">Player Attributes</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <h3 id="player-attributes-heading" className="text-base font-semibold">打法画像</h3>
            <StatsTooltip label="打法画像评分说明" content={profileHelp} />
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-fg-dim)]">{profile.benchmarkLabel}</p>
      </div>

      {firepower && <AttributeCard attribute={firepower} wide />}

      <div className="grid gap-3 lg:grid-cols-2">
        {others.map((attribute) => <AttributeCard key={attribute.key} attribute={attribute} />)}
      </div>

      <div className="pt-1">
        <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">Detail</p>
        <h3 className="mt-0.5 text-base font-semibold">详细数据</h3>
      </div>
    </section>
  );
}
