"use client";

import { useId, useState } from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { LINEUP_STYLE_CHARTS, lineupStyleAxis, selectLineupStylePoints, type LineupStyleMember, type LineupStylePoint } from "@/lib/teams/lineup-style";

export function TeamLineupStyle({ members }: { members?: readonly LineupStyleMember[] | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const charts = LINEUP_STYLE_CHARTS.map((chart) => ({ ...chart, points: selectLineupStylePoints(members ?? [], chart.x, chart.y) })).filter((chart) => chart.points.length > 0);
  return <section className="space-y-4" aria-label="阵容打法">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">LINEUP STYLE</p><h2 className="mt-1 text-lg font-semibold">阵容打法</h2></div>
      <p className="text-xs text-[var(--color-fg-mid)]">成员个人生涯 · 全站历史基准</p>
    </div>
    {charts.length ? <div className="grid min-w-0 gap-4 lg:grid-cols-3">
      {charts.map((chart) => <StyleChart key={chart.key} chart={chart} selected={selected} onSelect={setSelected} />)}
    </div> : <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">{members === null ? "阵容打法暂时无法加载，请稍后重试。" : "暂无可用阵容画像。"}</p>}
  </section>;
}

type Chart = (typeof LINEUP_STYLE_CHARTS)[number] & { points: LineupStylePoint[] };

function StyleChart({ chart, selected, onSelect }: { chart: Chart; selected: string | null; onSelect: (id: string | null) => void }) {
  const id = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const xAxis = lineupStyleAxis(chart.points.map((point) => point.x));
  const yAxis = lineupStyleAxis(chart.points.map((point) => point.y));
  // Insets reserve the full avatar radius even at true scores 0 and 100.
  const xPosition = (value: number) => 56 + (value - xAxis.min) / (xAxis.max - xAxis.min) * 320;
  const yPosition = (value: number) => 246 - (value - yAxis.min) / (yAxis.max - yAxis.min) * 210;
  const active = chart.points.find((point) => point.userId === activeId) ?? null;
  const nearby = active ? chart.points.filter((point) => Math.abs(xPosition(point.x) - xPosition(active.x)) < 56 && Math.abs(yPosition(point.y) - yPosition(active.y)) < 56) : [];
  const limited = chart.points.some((point) => point.limited);
  const preview = chart.points.every((point) => point.limited);
  function activate(point: LineupStylePoint) {
    setActiveId(point.userId);
    onSelect(point.userId);
  }
  return <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel)] p-3" onKeyDown={(event) => { if (event.key === "Escape") { setActiveId(null); onSelect(null); } }}>
    <div className="flex items-baseline justify-between gap-2 px-1">
      <h3 id={`${id}-title`} className="text-sm font-semibold">{chart.title}</h3>
      <span className="text-xs tabular-nums text-[var(--color-fg-dim)]">{chart.points.length} 人</span>
    </div>
    <div className="relative mt-2 aspect-[4/3]" role="group" aria-labelledby={`${id}-title`} aria-describedby={limited ? `${id}-sample` : undefined}>
      <svg viewBox="0 0 400 300" className="h-full w-full overflow-visible" aria-hidden="true">
        {xAxis.ticks.map((tick) => <g key={`x-${tick}`}>
          <line x1={xPosition(tick)} x2={xPosition(tick)} y1="36" y2="246" stroke="var(--color-border)" strokeDasharray="2 4" />
          <text x={xPosition(tick)} y="268" textAnchor="middle" fontSize="12" fill="var(--color-fg-mid)">{tick}</text>
        </g>)}
        {yAxis.ticks.map((tick) => <g key={`y-${tick}`}>
          <line x1="56" x2="376" y1={yPosition(tick)} y2={yPosition(tick)} stroke="var(--color-border)" strokeDasharray="2 4" />
          <text x="32" y={yPosition(tick) + 4} textAnchor="end" fontSize="12" fill="var(--color-fg-mid)">{tick}</text>
        </g>)}
        <text x="56" y="15" fontSize="12" fill="var(--color-fg-secondary)">{chart.yLabel}</text>
        <text x="216" y="293" textAnchor="middle" fontSize="12" fill="var(--color-fg-secondary)">{chart.xLabel}</text>
      </svg>
      {chart.points.map((point, index) => <button key={point.userId} type="button"
        className={`absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${point.limited ? "outline outline-1 outline-offset-2 outline-dashed outline-[var(--color-fg-dim)]" : "outline-none"} ${selected === point.userId ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-panel)]" : ""}`}
        style={{ left: `${xPosition(point.x) / 4}%`, top: `${yPosition(point.y) / 3}%`, zIndex: activeId === point.userId ? 20 : selected === point.userId ? 15 : index + 1 }}
        aria-label={`${point.name}，${chart.xLabel} ${point.x}，${chart.yLabel} ${point.y}${point.limited ? "，样本有限" : ""}`}
        aria-pressed={activeId === point.userId} aria-controls={`${id}-detail`}
        onMouseEnter={() => activate(point)} onFocus={() => activate(point)} onClick={() => activate(point)}>
        <PlayerAvatar name={point.name} avatarUrl={point.avatarUrl} size="sm" />
      </button>)}
    </div>
    <div id={`${id}-detail`} className="min-h-24 border-t border-[var(--color-border)] px-1 pt-3 text-xs" aria-live="polite">
      {active ? <>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <PlayerProfileLink userId={active.userId} className="min-w-0 break-words text-sm font-semibold">{active.name} <span aria-hidden="true">↗</span></PlayerProfileLink>
          <button type="button" className="min-h-6 min-w-6 text-[var(--color-fg-dim)] hover:text-[var(--color-fg-primary)]" aria-label="关闭选手信息" onClick={() => { setActiveId(null); onSelect(null); }}>×</button>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[var(--color-fg-secondary)]"><span>{chart.xLabel} <b className="tabular-nums">{active.x}</b></span><span>{chart.yLabel} <b className="tabular-nums">{active.y}</b></span><span>生涯 <b className="tabular-nums">{active.maps}</b> Maps</span></p>
        {active.limited && <p className="mt-1 text-[var(--color-fg-mid)]">本图部分属性样本有限。</p>}
        {nearby.length > 1 && <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-[var(--color-fg-mid)]">附近成员</span>{nearby.map((point) => <button type="button" key={point.userId} aria-label={`查看 ${point.name}`} aria-pressed={active.userId === point.userId} title={point.name} onClick={() => activate(point)} className="rounded-full focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)]"><PlayerAvatar name={point.name} avatarUrl={point.avatarUrl} size="sm" className="size-6" /></button>)}</div>}
      </> : <p className="text-[var(--color-fg-dim)]">悬停或点击头像查看选手</p>}
    </div>
    {limited && <p id={`${id}-sample`} className="mt-2 flex items-center gap-2 text-xs text-[var(--color-fg-mid)]"><span aria-hidden="true" className="size-3 rounded-full border border-dashed border-[var(--color-fg-dim)]" />{preview ? "样本有限预览" : "虚线圈表示部分属性样本有限"}</p>}
  </div>;
}
