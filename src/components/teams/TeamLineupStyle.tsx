"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { LINEUP_STYLE_CHARTS, lineupStyleAxis, selectLineupStylePoints, type LineupStyleMember, type LineupStylePoint } from "@/lib/teams/lineup-style";

type Selection = { chart: string; userId: string } | null;
type Chart = (typeof LINEUP_STYLE_CHARTS)[number] & { points: LineupStylePoint[] };

export function TeamLineupStyle({ members }: { members?: readonly LineupStyleMember[] | null }) {
  const [selection, setSelection] = useState<Selection>(null);
  const charts = LINEUP_STYLE_CHARTS.map((chart) => ({ ...chart, points: selectLineupStylePoints(members ?? [], chart.x, chart.y) })).filter((chart) => chart.points.length > 0);
  return <section className="space-y-4" aria-label="阵容打法">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">Player Styles</h2>
      <p className="text-xs text-[var(--color-fg-mid)]">成员个人生涯 · 全站历史基准</p>
    </div>
    {charts.length ? <div className="grid min-w-0 gap-4 lg:grid-cols-3">
      {charts.map((chart) => <StyleChart key={chart.key} chart={chart} selection={selection}
        onSelect={(userId) => setSelection({ chart: chart.key, userId })}
        onClose={() => setSelection((current) => current?.chart === chart.key ? null : current)} />)}
    </div> : <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">{members === null ? "阵容打法暂时无法加载，请稍后重试。" : "暂无可用阵容画像。"}</p>}
  </section>;
}

function StyleChart({ chart, selection, onSelect, onClose }: { chart: Chart; selection: Selection; onSelect: (id: string) => void; onClose: () => void }) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const returningFocus = useRef(false);
  const xAxis = lineupStyleAxis(chart.points.map((point) => point.x));
  const yAxis = lineupStyleAxis(chart.points.map((point) => point.y));
  // Scores retain their independently scaled domains; only the numeric chrome is hidden.
  const xPosition = (value: number) => 66 + (value - xAxis.min) / (xAxis.max - xAxis.min) * 292;
  const yPosition = (value: number) => 318 - (value - yAxis.min) / (yAxis.max - yAxis.min) * 244;
  const active = selection?.chart === chart.key ? chart.points.find((point) => point.userId === selection.userId) ?? null : null;
  const nearby = active ? chart.points.filter((point) => Math.abs(xPosition(point.x) - xPosition(active.x)) < 64 && Math.abs(yPosition(point.y) - yPosition(active.y)) < 64) : [];
  const limited = chart.points.some((point) => point.limited);
  const preview = chart.points.every((point) => point.limited);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const closeAndRestoreFocus = useCallback(() => {
    cancelClose();
    if (trigger && document.activeElement !== trigger) {
      returningFocus.current = true;
      trigger.focus({ preventScroll: true });
      returningFocus.current = false;
    }
    onClose();
  }, [cancelClose, trigger, onClose]);
  function enterCard() {
    const first = cardRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])");
    if (!first) return false;
    pinned.current = true;
    cancelClose();
    first.focus();
    return true;
  }
  function scheduleClose() {
    if (pinned.current) return;
    cancelClose();
    closeTimer.current = setTimeout(onClose, 180);
  }
  function activate(point: LineupStylePoint, button: HTMLButtonElement, pin = false) {
    cancelClose();
    pinned.current = pin;
    setTrigger(button);
    onSelect(point.userId);
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!active || !trigger) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!trigger!.contains(target) && !cardRef.current?.contains(target)) onClose();
    }
    function key(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); closeAndRestoreFocus(); } }
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", key);
    };
  }, [active, trigger, onClose, closeAndRestoreFocus]);

  return <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel)] p-3 sm:p-4">
    <div className="flex items-baseline justify-between gap-2 px-1">
      <div className="relative">
        <h3 id={`${id}-title`} className="text-base font-semibold">{chart.title}</h3>
        <HelpTooltip label={`${chart.title} 说明`} className="absolute left-full top-1 ml-1.5" content={<>
          <p>坐标轴自动缩放，象限表示当前成员间的相对风格；分数采用全站历史基准。</p>
          {chart.key === "entrying-trading" && <p className="mt-1">Crow 补枪多、被补少；Pack 双向较多；Loner 双向较少；Lamb 被补多、补枪少。</p>}
        </>} />
      </div>
      <span className="text-xs tabular-nums text-[var(--color-fg-dim)]">{chart.points.length} 人</span>
    </div>
    <div className="relative mx-auto mt-2 aspect-square w-full max-w-[17rem]" role="group" aria-labelledby={`${id}-title`} aria-describedby={limited ? `${id}-sample` : undefined}>
      <svg viewBox="0 0 400 400" className="h-full w-full" aria-hidden="true">
        <defs><marker id={`${id}-arrow`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5" fill="var(--color-fg-dim)" /></marker></defs>
        <rect x="30" y="20" width="364" height="344" fill="var(--color-panel-hi)" opacity="0.45" />
        <path d="M34 196H388" stroke="var(--color-fg-dim)" strokeOpacity="0.4" strokeWidth="1" markerEnd={`url(#${id}-arrow)`} />
        <path d="M212 360V26" stroke="var(--color-fg-dim)" strokeOpacity="0.4" strokeWidth="1" markerEnd={`url(#${id}-arrow)`} />
        <text x="40" y="42" fontSize="16" fill="var(--color-fg-mid)">{chart.corners[0]}</text>
        <text x="384" y="42" textAnchor="end" fontSize="16" fill="var(--color-fg-mid)">{chart.corners[1]}</text>
        <text x="40" y="353" fontSize="16" fill="var(--color-fg-mid)">{chart.corners[2]}</text>
        <text x="384" y="353" textAnchor="end" fontSize="16" fill="var(--color-fg-mid)">{chart.corners[3]}</text>
        <text transform="translate(15 196) rotate(-90)" textAnchor="middle" fontSize="16" fill="var(--color-fg-secondary)">{chart.yLabel.toUpperCase()}</text>
        <text x="212" y="389" textAnchor="middle" fontSize="16" fill="var(--color-fg-secondary)">{chart.xLabel.toUpperCase()}</text>
      </svg>
      {chart.points.map((point, index) => <button key={point.userId} type="button"
        className={`absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${point.limited ? "outline outline-1 outline-offset-2 outline-dashed outline-[var(--color-fg-dim)]" : "outline-none"} ${selection?.userId === point.userId ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-panel)]" : ""}`}
        style={{ left: `${xPosition(point.x) / 4}%`, top: `${yPosition(point.y) / 4}%`, zIndex: active?.userId === point.userId ? 20 : selection?.userId === point.userId ? 15 : index + 1 }}
        aria-label={`${point.name}，${chart.xLabel} ${point.x}，${chart.yLabel} ${point.y}${point.limited ? "，样本有限" : ""}`}
        aria-haspopup="dialog" aria-expanded={active?.userId === point.userId} aria-controls={active ? `${id}-detail` : undefined}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") activate(point, event.currentTarget); }}
        onPointerLeave={scheduleClose} onFocus={(event) => { if (!returningFocus.current) activate(point, event.currentTarget); }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey && active?.userId === point.userId && enterCard()) event.preventDefault();
        }}
        onClick={(event) => { activate(point, event.currentTarget, true); if (event.detail === 0) enterCard(); }}>
        <PlayerAvatar name={point.name} avatarUrl={point.avatarUrl} size="sm" />
      </button>)}
    </div>
    {limited && <p id={`${id}-sample`} className="mt-1 flex items-center gap-2 px-1 text-[10px] text-[var(--color-fg-dim)]"><span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-[var(--color-fg-dim)]" />{preview ? "样本有限预览" : "虚线圈表示部分属性样本有限"}</p>}
    {active && trigger && <PlayerCard id={`${id}-detail`} chart={chart} active={active} nearby={nearby} trigger={trigger} cardRef={cardRef}
      onEnter={cancelClose} onLeave={scheduleClose} onClose={closeAndRestoreFocus}
      onChoose={(point) => { pinned.current = true; cancelClose(); onSelect(point.userId); }} />}
  </div>;
}

function PlayerCard({ id, chart, active, nearby, trigger, cardRef, onEnter, onLeave, onClose, onChoose }: {
  id: string; chart: Chart; active: LineupStylePoint; nearby: LineupStylePoint[]; trigger: HTMLButtonElement;
  cardRef: React.RefObject<HTMLDivElement | null>; onEnter: () => void; onLeave: () => void; onClose: () => void; onChoose: (point: LineupStylePoint) => void;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const rect = trigger.getBoundingClientRect();
    const card = cardRef.current;
    if (!card) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const below = rect.bottom + 8;
    setPosition({
      left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 12)),
      top: Math.max(12, Math.min(below + height <= innerHeight - 12 ? below : rect.top - height - 8, innerHeight - height - 12)),
    });
  }, [active, trigger, cardRef]);
  return createPortal(<div ref={cardRef} id={id} role="dialog" aria-label={`${active.name} · ${chart.title}`}
    onPointerEnter={onEnter} onPointerLeave={onLeave}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...(cardRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
      const boundary = event.shiftKey ? controls[0] : controls.at(-1);
      if (event.target === boundary) { event.preventDefault(); onClose(); }
    }}
    className="fixed z-[200] w-72 max-w-[calc(100vw-24px)] border border-[var(--color-border-hi)] bg-[var(--color-panel-hi)] p-3 text-xs leading-5 text-[var(--color-fg-primary)] shadow-lg"
    style={position ? { ...position } : { visibility: "hidden" }}>
    <div className="flex items-start gap-2">
      <PlayerAvatar name={active.name} avatarUrl={active.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1"><PlayerProfileLink userId={active.userId} className="break-words text-sm font-semibold">{active.name} <span aria-hidden="true">↗</span></PlayerProfileLink><p className="text-[var(--color-fg-mid)]">个人生涯 · {active.maps} Maps</p></div>
      <button type="button" className="min-h-6 min-w-6 text-[var(--color-fg-dim)] hover:text-[var(--color-fg-primary)]" aria-label="关闭选手信息" onClick={onClose}>×</button>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-2">
      <div className="text-[var(--color-fg-mid)]">{chart.xLabel}<span className="ml-2 font-semibold tabular-nums text-[var(--color-fg-primary)]">{active.x}</span>{active.xLimited && <span className="ml-1.5 whitespace-nowrap text-[10px] text-[var(--color-fg-dim)]">样本有限</span>}</div>
      <div className="text-[var(--color-fg-mid)]">{chart.yLabel}<span className="ml-2 font-semibold tabular-nums text-[var(--color-fg-primary)]">{active.y}</span>{active.yLimited && <span className="ml-1.5 whitespace-nowrap text-[10px] text-[var(--color-fg-dim)]">样本有限</span>}</div>
    </div>
    {nearby.length > 1 && <div className="mt-3 border-t border-[var(--color-border)] pt-2"><p className="mb-2 text-[var(--color-fg-mid)]">附近成员 · 点击切换</p><div className="flex flex-wrap gap-2">{nearby.map((point) => <button type="button" key={point.userId} aria-label={`查看 ${point.name}`} aria-pressed={active.userId === point.userId} title={point.name} onClick={() => onChoose(point)} className={`rounded-full focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)] ${active.userId === point.userId ? "ring-1 ring-[var(--color-accent)]" : ""}`}><PlayerAvatar name={point.name} avatarUrl={point.avatarUrl} size="sm" /></button>)}</div></div>}
  </div>, document.body);
}
