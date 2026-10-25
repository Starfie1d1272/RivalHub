"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { getTelemetryComparisonAction } from "@/app/admin/telemetry/actions";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { Empty, Heading, Pick, date, duration, number } from "./Elements";
export function Comparison({ data }: { data: Analysis }) {
  const [mode, setMode] = useState("period"), [value, setValue] = useState("");
  const [result, setResult] = useState<{ data: Analysis; mode: string; value: string; pair: { current: Analysis; previous: Analysis } } | null>(null);
  const pair = result?.data === data && result.mode === mode && result.value === value ? result.pair : null;
  const [errorKey, setErrorKey] = useState<{ data: Analysis; mode: string; value: string } | null>(null), [pending, start] = useTransition();
  const error = errorKey?.data === data && errorKey.mode === mode && errorKey.value === value;
  const generation = useRef(0);
  useEffect(() => { generation.current++; }, [data, mode, value]);
  const compare = () => {
    const token = ++generation.current; setResult(null); setErrorKey(null);
    const w = data.product.window;
    const current = { ...data.filters, from: new Date(w.requestedFrom).toISOString(), to: new Date(w.requestedTo).toISOString() };
    const previous = mode === "period" ? { ...current, from: new Date(w.requestedFrom - (w.requestedTo - w.requestedFrom)).toISOString(), to: current.from } : { ...current, [mode]: value };
    start(async () => { try {
      const result = await getTelemetryComparisonAction(current, previous);
      if (generation.current !== token) return;
      if (result.current.status === "ready" && result.previous.status === "ready") setResult({ data, mode, value, pair: { current: result.current.data, previous: result.previous.data } }); else setErrorKey({ data, mode, value });
    } catch { if (generation.current === token) setErrorKey({ data, mode, value }); } });
  };
  const keys = <T,>(a: T[], b: T[], key: (row: T) => string) => [...new Set([...a, ...b].map(key))];
  const rows = pair ? [
    ...keys(pair.current.metrics, pair.previous.metrics, m => m.key).map(key => {
      const a = pair.current.metrics.find(m => m.key === key), b = pair.previous.metrics.find(m => m.key === key);
      return { key, label: `${a?.label ?? b?.label} P50`, a: duration(a?.p50, key), b: duration(b?.p50, key), an: a?.n ?? 0, bn: b?.n ?? 0 };
    }),
    ...keys(pair.current.product.tasks.filter(t => t.attempts), pair.previous.product.tasks.filter(t => t.attempts), t => t.key).flatMap(key => {
      const a = pair.current.product.tasks.find(t => t.key === key), b = pair.previous.product.tasks.find(t => t.key === key);
      return [
        { key, label: `${a?.label ?? b?.label} · 成熟尝试完成率`, a: a?.completionPct == null ? "—" : `${number(a.completionPct)}% (${a.maturedCompleted}/${a.matured})`, b: b?.completionPct == null ? "—" : `${number(b.completionPct)}% (${b.maturedCompleted}/${b.matured})`, an: a?.matured ?? 0, bn: b?.matured ?? 0 },
        { key: `${key}-time`, label: `${a?.label ?? b?.label} · 完成用时 P50`, a: duration(a?.elapsed.p50), b: duration(b?.elapsed.p50), an: a?.elapsed.n ?? 0, bn: b?.elapsed.n ?? 0 },
      ];
    }),
    ...keys(pair.current.product.operationTrends, pair.previous.product.operationTrends, o => o.operation).map(key => {
      const a = pair.current.product.operationTrends.find(o => o.operation === key), b = pair.previous.product.operationTrends.find(o => o.operation === key);
      return { key, label: `${a?.label ?? b?.label} · 成功响应 P50`, a: duration(a?.successTiming.p50), b: duration(b?.successTiming.p50), an: a?.successTiming.n ?? 0, bn: b?.successTiming.n ?? 0 };
    }),
  ] : [];
  return <Panel contentClassName="p-0"><Heading title="变化比较" note="保留其余筛选；先对齐页面、任务与设备，结合两侧样本量判断。" /><div className="grid gap-3 p-4 sm:grid-cols-3"><Pick label="比较方式" value={mode} all={false} options={[{ value: "period", label: "前一个等长窗口" }, { value: "release", label: "另一版本" }, { value: "device", label: "另一设备" }, { value: "eventId", label: "另一赛事" }]} onChange={v => { setMode(v); setValue(""); }} />{mode !== "period" && <Pick label="对照组" value={value} options={data.options[mode as "release" | "device" | "eventId"]} onChange={setValue} />}<Button variant="outline" className="self-end" disabled={pending || (mode !== "period" && !value)} onClick={compare}>{pending ? "正在比较…" : "读取两组数据"}</Button></div>
    {error && <Empty>比较读取失败，请重试。</Empty>}{pair && <div className="p-4 pt-0">
      <p className="mb-3 text-xs text-muted-foreground">当前 {date(pair.current.product.window.from, true)} – {date(pair.current.product.window.to, true)} · 对照 {date(pair.previous.product.window.from, true)} – {date(pair.previous.product.window.to, true)}</p>
      {mode !== "period" && <p className="mb-3 text-xs text-muted-foreground">当前组：{data.options[mode as "release" | "device" | "eventId"].find(o => o.value === data.filters[mode as "release" | "device" | "eventId"])?.label ?? "该维度全部样本"}；对照组：{data.options[mode as "release" | "device" | "eventId"].find(o => o.value === value)?.label ?? value}。其余条件保持一致。</p>}
      {(pair.current.meta.partial || pair.previous.meta.partial) && <p className="mb-3 text-sm">至少一侧受到保留边界或查询预算限制，观察范围不完整。</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-3">指标</th><th>当前 / 样本数</th><th>对照 / 样本数</th></tr></thead><tbody>{rows.map(r => <tr key={r.key} className="border-t border-border"><td className="py-3 pr-4">{r.label}</td><td className="pr-4">{r.a} · {r.an}</td><td>{r.b} · {r.bn}{Math.min(r.an, r.bn) < 20 && <span className="ml-2 text-xs text-muted-foreground">样本不足</span>}</td></tr>)}</tbody></table></div>
      <div className="mt-4 grid gap-4 text-xs text-muted-foreground sm:grid-cols-2">{[pair.current, pair.previous].map((d, i) => <p key={i}>{i ? "对照" : "当前"}设备构成：{d.distributions.device.map(v => `${v.label} ${number(v.share)}% (${v.n})`).join("、")}；增强页面 {d.product.coverage.enhancedPages}/{d.product.coverage.pages}</p>)}</div>
      <p className="mt-3 text-xs text-muted-foreground">自然分组比较反映观察到的差异；流量构成、赛事阶段与采集覆盖都可能变化。任务耗时仅统计成熟窗口内的完成样本。</p>
    </div>}
  </Panel>;
}
