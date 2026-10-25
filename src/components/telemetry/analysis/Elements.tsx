"use client";

import { useId } from "react";
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
  const values = points.flatMap(p => [p.value, p.secondary]).filter((v): v is number => v != null && Number.isFinite(v));
  const max = Math.max(1, ...values);
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
  return <Panel contentClassName="p-0">
    <Heading title={title} note={note} />
    {!values.length ? <Empty>此范围尚无可用样本。</Empty> : <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>● {label}</span>{secondaryLabel && <span>┄ {secondaryLabel}</span>}<span>北京时间 · 空缺不补零</span></div>
      <svg viewBox="0 0 960 215" className="w-full" role="img" aria-labelledby={id}>
        <title id={id}>{title}；下方可展开查看数据</title>
        {[0, .5, 1].map(t => <g key={t}><line x1="56" x2="920" y1={y(max * t)} y2={y(max * t)} stroke="var(--color-border)" strokeDasharray="3 5" />
          <text x="48" y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="var(--color-fg-mid)">{format(max * t)}</text></g>)}
        <path d={paths("value")} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" />
        {secondaryLabel && <path d={paths("secondary")} fill="none" stroke="var(--color-fg-mid)" strokeDasharray="5 4" strokeWidth="1.5" />}
        {points.map((p, i) => <g key={p.at}>{p.value != null && <circle cx={x(i)} cy={y(p.value)} r="3.5" fill="var(--color-accent)" tabIndex={0} aria-label={`${date(p.at)}，${label} ${format(p.value)}，${p.n ?? "—"} 样本`}><title>{date(p.at)} · {label} {format(p.value)}{secondaryLabel ? ` · ${secondaryLabel} ${format(p.secondary)}` : ""}{p.n != null ? ` · ${p.n} 样本` : ""}</title></circle>}
          {(i === 0 || i === points.length - 1 || (points.length > 3 && i === Math.floor(points.length / 2))) && <text x={x(i)} y="205" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--color-fg-mid)">{date(p.at)}</text>}
        </g>)}
      </svg>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看趋势数据与样本数</summary>
        <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left tabular-nums"><thead><tr><th className="py-2">时间</th><th>{label}</th>{secondaryLabel && <th>{secondaryLabel}</th>}<th>样本数</th></tr></thead><tbody>
          {points.map(p => <tr key={p.at} className="border-t border-border"><td className="py-2">{date(p.at, true)}</td><td>{format(p.value)}</td>{secondaryLabel && <td>{format(p.secondary)}</td>}<td>{p.n == null ? "—" : number(p.n)}</td></tr>)}
        </tbody></table></div>
      </details>
    </div>}
  </Panel>;
}
