"use client";

import { useEffect, useState } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { parseAnalysisQuery, type AnalysisFilters } from "@/lib/telemetry/analysis-query";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pick } from "./analysis/Elements";

const inputDate = (value: string, end = false) => value ? new Date(Date.parse(value) + 8 * 3600000 - (end ? 1 : 0)).toISOString().slice(0, 10) : "";
export function TelemetryFilters({ filters, options, update, apply, reset, exactRelease = false }: {
  filters: AnalysisFilters; options: Analysis["options"];
  update: (key: keyof AnalysisFilters, value: string) => void;
  apply: (filters: AnalysisFilters) => void; reset: () => void; exactRelease?: boolean;
}) {
  const [from, setFrom] = useState(inputDate(filters.from));
  const [to, setTo] = useState(inputDate(filters.to, true));
  const [release, setRelease] = useState(filters.release);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => { setFrom(inputDate(filters.from)); setTo(inputDate(filters.to, true)); setRelease(filters.release); setError(""); }, 0);
    return () => clearTimeout(timer);
  }, [filters.from, filters.to, filters.release]);
  function dates() {
    const end = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
    if (!Number.isFinite(end)) { setError("请选择完整日期。"); return; }
    const next = { ...filters, from: `${from}T00:00:00+08:00`, to: new Date(end).toISOString() };
    if (!parseAnalysisQuery(next)) { setError("请选择最多七天的有效日期范围。"); return; }
    setError(""); apply(next);
  }
  return <Panel contentClassName="p-4">
    <div className="grid items-end gap-3 sm:grid-cols-3">
      <Pick label={filters.from ? "时间范围（自定义日期生效中）" : "时间范围"} value={filters.hours} all={false} options={[{ value: "24", label: "最近 24 小时" }, { value: "6", label: "最近 6 小时" }, { value: "168", label: "最近 7 天" }]} onChange={value => update("hours", value)} />
      <Pick label="设备" value={filters.device} options={options.device} onChange={value => update("device", value)} />
      {exactRelease ? <div className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1.5 text-xs text-muted-foreground">版本精确值<Input className="h-9" maxLength={80} value={release} onChange={event => setRelease(event.target.value)} /></label><Button variant="outline" size="sm" onClick={() => { if (!parseAnalysisQuery({ ...filters, release })) { setError("版本值无效。"); return; } setError(""); update("release", release); }}>应用版本</Button></div>
        : <Pick label="版本" value={filters.release} options={options.release} onChange={value => update("release", value)} />}
    </div>
    <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer py-1">更多筛选与自定义日期{filters.from ? " · 已指定日期" : ""}{[filters.scope, filters.task, filters.eventId, filters.route, filters.role, filters.scene, filters.browser, filters.source, filters.navigationType, filters.visibility, filters.operation].some(Boolean) ? " · 有筛选生效" : ""}</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Pick label="工作范围" value={filters.scope} options={[{ value: "public", label: "前台内容与操作" }, { value: "admin", label: "后台管理" }]} onChange={value => update("scope", value)} />
        <Pick label="赛事" value={filters.eventId} options={options.eventId} onChange={value => update("eventId", value)} />
        <Pick label="任务" value={filters.task} options={options.task} onChange={value => update("task", value)} />
        {([["route", "页面"], ["role", "角色"], ["scene", "赛事类型"], ["browser", "浏览器"], ["source", "入口来源"], ["navigationType", "导航类型"], ["visibility", "报告时可见性"], ["operation", "操作"]] as const).map(([key, label]) => <Pick key={key} label={label} value={filters[key]} options={options[key]} onChange={value => update(key, value)} />)}
        <Pick label="版本口径" value={filters.releaseBasis} all={false} options={[{ value: "client", label: "客户端构建" }, { value: "ticket", label: "接收票据签发" }]} onChange={value => update("releaseBasis", value)} />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3"><label className="space-y-1">开始日期（北京时间）<Input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label className="space-y-1">结束日期（含当天）<Input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><Button variant="outline" size="sm" onClick={dates}>应用日期</Button><Button variant="ghost" size="sm" onClick={reset}>重置条件</Button></div>
      {error && <p role="alert" className="mt-2">{error}</p>}
    </details>
  </Panel>;
}
