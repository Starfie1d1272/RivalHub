"use client";

import { useId, useState } from "react";
import { Panel } from "@/components/rivalhub/Panel";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export function duration(value: number | null | undefined, metric = "") {
  if (value == null) return "—";
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 86400000) return `${number(value / 86400000)} 天`;
  if (value >= 3600000) return `${number(value / 3600000)} 小时`;
  if (value >= 60000) return `${number(value / 60000)} 分钟`;
  return value >= 1000 ? `${number(value / 1000)} 秒` : `${Math.round(value)} ms`;
}
export function date(value: number, full = false) {
  const s = new Date(value + 8 * 3600000).toISOString();
  return full ? s.slice(0, 16).replace("T", " ") : s.slice(5, 16).replace("T", " ");
}
export function Help({ text }: { text: string }) {
  return <span className="relative ml-1 inline-block w-3"><HelpTooltip label="查看指标说明" content={text} /></span>;
}
export function Pick({ label, value, options, onChange, all = true }: {
  label: string; value: string; options: readonly { value: string; label: string }[];
  onChange: (value: string) => void; all?: boolean;
}) {
  return <label className="block min-w-0 space-y-1.5 text-xs text-muted-foreground"><span>{label}</span>
    <Select value={value || "__all"} onValueChange={v => onChange(v === "__all" ? "" : v)}>
      <SelectTrigger className="h-9 w-full" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{all && <SelectItem value="__all">全部{label}</SelectItem>}
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </label>;
}
export function Empty({ children = "当前范围暂无数据。" }: { children?: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
export function Heading({ title, note, action }: { title: string; note?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div>
    <h2 className="text-sm font-semibold">{title}</h2>{note && <div className="mt-1 text-xs leading-5 text-muted-foreground">{note}</div>}
  </div>{action}</div>;
}
export function Stat({ label, value, note, help }: { label: string; value: React.ReactNode; note?: React.ReactNode; help?: string }) {
  return <div className="min-w-0 p-4"><p className="text-xs text-muted-foreground">{label}{help && <Help text={help} />}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>{note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
  </div>;
}
type Tone = "neutral" | "ok" | "warn";
export function vitalStatus(metric: string, n: number, p75: number | null | undefined, partial = false): { label: string; tone: Tone } {
  if (!n || p75 == null) return { label: "暂无有效样本", tone: "neutral" };
  if (n < 20) return { label: `样本不足 · ${number(n)} 个`, tone: "neutral" };
  if (partial) return { label: "覆盖不完整 · 仅当前样本", tone: "warn" };
  const threshold = ({ LCP: 2500, INP: 200, CLS: .1 } as Record<string, number>)[metric];
  if (threshold == null) return { label: `${number(n)} 个有效样本`, tone: "neutral" };
  return p75 <= threshold ? { label: "当前样本达到参考值", tone: "ok" } : { label: "高于参考值 · 值得关注", tone: "warn" };
}
export function MetricCard({ label, value, note, tone = "neutral", onClick }: { label: string; value: React.ReactNode; note: string; tone?: Tone; onClick?: () => void }) {
  const content = <><span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">{label}{onClick && <span aria-hidden="true">↗</span>}</span><span className="my-3 block text-2xl font-semibold tracking-tight sm:text-3xl tabular-nums">{value}</span><span className={`block text-xs leading-5 ${tone === "ok" ? "text-[var(--color-ok)]" : tone === "warn" ? "text-[var(--color-warn)]" : "text-muted-foreground"}`}>{note}</span></>;
  return <Panel contentClassName="p-0">{onClick ? <button onClick={onClick} className="block h-full w-full rounded-md p-5 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary">{content}</button> : <div className="p-5">{content}</div>}</Panel>;
}
export function CoverageBadge({ status, detail }: { status: "complete" | "partial" | "unsupported"; detail?: string }) {
  return <div role="status" className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-sm border px-2 py-1 ${status === "complete" ? "border-border text-muted-foreground" : "border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]"}`}>{status === "complete" ? "范围已覆盖" : status === "partial" ? "部分覆盖" : "筛选不支持"}</span>{detail && <span className="text-muted-foreground">{detail}</span>}</div>;
}
export function Bars({ rows, unit = "样本" }: { rows: { key: string; label: string; value: number; displayValue?: string; onClick?: () => void }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return !rows.length ? <Empty /> : <div className="space-y-4">{rows.map(r => {
    const content = <><span className="mb-2 flex justify-between gap-3 text-xs"><span className="min-w-0 break-words">{r.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{r.displayValue ?? number(r.value)} {unit}</span></span><span className="block h-2 overflow-hidden rounded-sm bg-secondary"><span className="block h-full rounded-sm bg-primary/70" style={{ width: `${r.value / max * 100}%` }} /></span></>;
    return r.onClick ? <button key={r.key} onClick={r.onClick} className="block w-full rounded-sm text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{content}</button> : <div key={r.key}>{content}</div>;
  })}</div>;
}
export function Distribution({ counts, bounds, metric = "" }: { counts: readonly number[]; bounds: readonly number[]; metric?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const labels = counts.map((_, i) => i === 0 ? `≤ ${duration(bounds[0], metric)}` : i === bounds.length ? `> ${duration(bounds[i - 1], metric)}` : `${duration(bounds[i - 1], metric)} – ${duration(bounds[i], metric)}`);
  const max = Math.max(1, ...counts), step = 864 / counts.length;
  return <div>
    <p className="mb-3 min-h-5 text-xs text-muted-foreground" aria-live="polite">{active == null ? "按耗时区间查看样本分布" : `${labels[active]} · ${number(counts[active])} 样本`}</p>
    <div className="overflow-x-auto"><svg viewBox="0 0 960 240" className="w-full min-w-[640px] sm:min-w-0" role="img" aria-labelledby={id}>
      <title id={id}>{"耗时区间样本分布；下方可展开查看数据"}</title>
      {[0, .5, 1].map(t => <g key={t}><line x1="56" x2="920" y1={180 - t * 140} y2={180 - t * 140} stroke="var(--color-border)" strokeDasharray="3 5" /><text x="48" y={184 - t * 140} textAnchor="end" fontSize="11" fill="var(--color-fg-mid)">{number(max * t)}</text></g>)}
      {counts.map((count, i) => <g key={i} tabIndex={0} aria-label={`${labels[i]}，${number(count)} 样本`} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} className="focus-visible:outline-2 focus-visible:outline-primary">
        <rect x={56 + i * step + 3} y={40} width={Math.max(1, step - 6)} height="140" fill="transparent" />
        <rect x={56 + i * step + 3} y={180 - count / max * 140} width={Math.max(1, step - 6)} height={count / max * 140} rx="3" fill={active === i ? "var(--color-accent)" : "var(--color-accent-edge)"} />
        {(counts.length <= 6 || i % Math.ceil(counts.length / 5) === 0 || i === counts.length - 1) && <text x={56 + (i + .5) * step} y="208" textAnchor="middle" fontSize="11" fill="var(--color-fg-mid)">{i === counts.length - 1 ? `> ${duration(bounds.at(-1), metric)}` : `≤ ${duration(bounds[i], metric)}`}</text>}
        <title>{`${labels[i]} · ${number(count)} 样本`}</title>
      </g>)}
    </svg></div>
    <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看分布数据</summary><table aria-label="分布样本" className="mt-3 w-full text-left tabular-nums"><thead><tr><th>区间</th><th>样本</th></tr></thead><tbody>{counts.map((count, i) => <tr key={i} className="border-t border-border"><td className="py-2">{labels[i]}</td><td>{number(count)}</td></tr>)}</tbody></table></details>
  </div>;
}
export function SmallSample({ n }: { n: number }) {
  return <span className="whitespace-nowrap text-xs text-muted-foreground">{number(n)} 样本{n > 0 && n < 20 ? " · 少量样本" : ""}</span>;
}
export interface ChartPoint { at: number; value: number | null; secondary?: number | null; n?: number }
/** Gaps stay gaps. The accessible data table is the same supplied read model as the chart. */
export function Series({ title, note, points, label = "中位数", secondaryLabel, format = number }: {
  title: string; note?: React.ReactNode; points: ChartPoint[]; label?: string; secondaryLabel?: string;
  format?: (value: number | null | undefined) => string;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const values = points.flatMap(p => [p.value, p.secondary]).filter((v): v is number => v != null && Number.isFinite(v));
  const max = Math.max(0, ...values) || 1;
  const hasData = values.length > 0 && !points.every(p => p.n === 0 && (p.value == null || p.value === 0) && (p.secondary == null || p.secondary === 0));
  const focused = active == null ? undefined : points[active];
  const x = (i: number) => 56 + (points[i].at - (points[0]?.at ?? 0)) * 864 / Math.max(1, (points.at(-1)?.at ?? 0) - (points[0]?.at ?? 0));
  const y = (n: number) => 172 - n / max * 140;
  const paths = (key: "value" | "secondary") => {
    let started = false;
    return points.map((p, i) => {
      const v = p[key];
      if (v == null) { started = false; return ""; }
      const command = started ? "L" : "M"; started = true;
      return `${command}${x(i)},${y(v)}`;
    }).join(" ");
  };
  const areas: string[] = [];
  let segment: number[] = [];
  function closeArea() {
    if (segment.length) areas.push(`M${x(segment[0])},172 ${segment.map(i => `L${x(i)},${y(points[i].value!)}`).join(" ")} L${x(segment.at(-1)!)},172 Z`);
    segment = [];
  }
  points.forEach((p, i) => { if (p.value == null) closeArea(); else segment.push(i); });
  closeArea();
  return <Panel contentClassName="p-0">
    <Heading title={title} note={note} />
    {!hasData ? <Empty>此范围尚无可用样本。</Empty> : <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>● {label}</span>{secondaryLabel && <span>┄ {secondaryLabel}</span>}<span>北京时间</span></div>
      <div className="mb-2 min-h-5 text-xs tabular-nums text-muted-foreground" aria-live="polite">{focused ? `${date(focused.at)} · ${label} ${format(focused.value)}${secondaryLabel ? ` · ${secondaryLabel} ${format(focused.secondary)}` : ""}${focused.n != null ? ` · ${focused.n} 样本` : ""}` : "悬停或用 Tab 聚焦数据点"}</div>
      <div className="overflow-x-auto"><svg viewBox="0 0 960 215" className="w-full min-w-[640px] overflow-visible sm:min-w-0" role="img" aria-labelledby={id}>
        <title id={id}>{`${title}；下方可展开查看数据`}</title>
        {[0, .25, .5, .75, 1].map(t => <g key={t}><line x1="56" x2="920" y1={y(max * t)} y2={y(max * t)} stroke="var(--color-border)" strokeDasharray="3 5" />
          <text x="48" y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="var(--color-fg-mid)">{format(max * t)}</text></g>)}
        {areas.map((d, i) => <path key={i} d={d} fill="var(--color-accent-soft)" />)}
        <path d={paths("value")} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" />
        {secondaryLabel && <path d={paths("secondary")} fill="none" stroke="var(--color-fg-mid)" strokeDasharray="5 4" strokeWidth="1.5" />}
        {points.map((p, i) => <g key={p.at}>{p.value != null && <circle cx={x(i)} cy={y(p.value)} r={active === i ? 6 : 3.5} fill="var(--color-accent)" className="focus-visible:outline-2 focus-visible:outline-primary" tabIndex={0} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} aria-label={`${date(p.at)}，${label} ${format(p.value)}，${p.n ?? "—"} 样本`}><title>{`${date(p.at)} · ${label} ${format(p.value)}${secondaryLabel ? ` · ${secondaryLabel} ${format(p.secondary)}` : ""}${p.n != null ? ` · ${p.n} 样本` : ""}`}</title></circle>}
          {(i === 0 || i === points.length - 1 || (points.length > 3 && i === Math.floor(points.length / 2))) && <text x={x(i)} y="205" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--color-fg-mid)">{date(p.at)}</text>}
        </g>)}
      </svg></div>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看趋势数据与样本数</summary>
        <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left tabular-nums"><thead><tr><th className="py-2">时间</th><th>{label}</th>{secondaryLabel && <th>{secondaryLabel}</th>}<th>样本数</th></tr></thead><tbody>
          {points.map(p => <tr key={p.at} className="border-t border-border"><td className="py-2">{date(p.at, true)}</td><td>{format(p.value)}</td>{secondaryLabel && <td>{format(p.secondary)}</td>}<td>{p.n == null ? "—" : number(p.n)}</td></tr>)}
        </tbody></table></div>
      </details>
    </div>}
  </Panel>;
}
