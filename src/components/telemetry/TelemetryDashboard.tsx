"use client";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { cat, metricLabels } from "@/lib/telemetry/analysis-presentation";
import { Panel } from "@/components/rivalhub/Panel";
import { PageHeader } from "@/components/rivalhub/PageHeader";
import { PageLayout } from "@/components/rivalhub/Layout";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  analysisDefaults as blank,
  type AnalysisFilters as Filters,
} from "@/lib/telemetry/analysis-query";
import { getTelemetryAnalysisAction } from "@/app/admin/telemetry/actions";
const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
const time = (n: number, full = false) => {
  const s = new Date(n + 8 * 3600000).toISOString();
  return full
    ? s.slice(0, 16).replace("T", " ")
    : s.slice(5, 16).replace("T", " ");
};
const metricValue = (n: number | null, metric: string) =>
  n == null
    ? "—"
    : metric === "CLS"
      ? n.toFixed(3)
      : n >= 1000
        ? `${(n / 1000).toFixed(2)} 秒`
        : `${Math.round(n)} ms`;
function Help({ text }: { text: string }) {
  return (
    <span className="relative ml-1 inline-block w-3">
      <HelpTooltip label="查看指标说明" content={text} />
    </span>
  );
}
function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0">
      <span className="text-[var(--color-fg-mid)] mb-1.5 block text-xs">
        {label}
      </span>
      <Select
        value={value || "__all"}
        onValueChange={(v) => onChange(v === "__all" ? "" : v)}
      >
        <SelectTrigger className="h-9 w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {label !== "时间范围" && (
            <SelectItem value="__all">全部{label}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function Empty({ text = "当前筛选范围暂无报告。" }: { text?: string }) {
  return (
    <p className="text-[var(--color-fg-mid)] py-12 text-center text-sm">
      {text}
    </p>
  );
}
function Stat({
  label,
  value,
  note,
  help,
  tone,
}: {
  label: string;
  value: number | string;
  note?: string;
  help?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <p className="text-[var(--color-fg-mid)] text-xs sm:text-sm">
        {label}
        {help && <Help text={help} />}
      </p>
      <p
        className={`tabular-nums mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${tone ?? ""}`}
      >
        {typeof value === "number" ? fmt(value) : value}
      </p>
      {note && (
        <p className="text-[var(--color-fg-mid)] mt-2 text-xs">{note}</p>
      )}
    </div>
  );
}
function Distribution({
  rows,
  onPick,
}: {
  rows: { key: string; label: string; n: number; share: number }[];
  onPick?: (key: string) => void;
}) {
  return (
    <div className="space-y-1">
      {rows.length ? (
        rows.map((r) => (
          <button
            key={r.key}
            disabled={!onPick}
            onClick={() => onPick?.(r.key)}
            className="relative flex min-h-10 w-full items-center justify-between gap-3 overflow-hidden rounded-sm px-3 py-2 text-left text-sm hover:bg-secondary disabled:cursor-default"
          >
            <span
              className="absolute inset-y-1 left-0 rounded-sm bg-[var(--color-accent-soft)]"
              style={{ width: `${r.share}%` }}
            />
            <span className="relative">{r.label}</span>
            <span className="tabular-nums text-[var(--color-fg-mid)] relative whitespace-nowrap">
              {fmt(r.n)}{" "}
              <span className="ml-3 text-xs">{r.share.toFixed(1)}%</span>
            </span>
          </button>
        ))
      ) : (
        <Empty />
      )}
    </div>
  );
}
function Trend({ rows }: { rows: Analysis["buckets"] }) {
  const [series, setSeries] = useState<
    "views" | "sessions" | "operations" | "filters" | "errors"
  >("views");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r[series]));
  const x = (i: number) => 40 + (i * 915) / Math.max(1, rows.length - 1);
  const y = (n: number) => 170 - (n / max) * 135;
  const points = rows.map((r, i) => `${x(i)},${y(r[series])}`).join(" ");
  const names = {
    views: "页面访问",
    sessions: "活跃会话",
    operations: "业务操作",
    filters: "筛选行为",
    errors: "异常报告",
  };
  return (
    <Panel contentClassName="overflow-x-auto p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-sm font-semibold">使用趋势</h2>
        <div className="flex flex-wrap gap-1">
          {Object.entries(names).map(([k, l]) => (
            <Button
              key={k}
              variant={series === k ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setSeries(k as typeof series);
                setHover(null);
              }}
            >
              {l}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex justify-between px-5 pt-4 text-xs text-[var(--color-fg-mid)]">
        <span>
          {names[series]} · {rows.length <= 8 ? "按天" : "按小时"}
        </span>
        <span>
          {hover !== null && rows[hover]
            ? `${time(rows[hover].at)} · ${rows[hover][series]} 次`
            : "北京时间 UTC+8"}
        </span>
      </div>
      <svg
        viewBox="0 0 1000 210"
        className="h-[195px] min-w-[600px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${names[series]}趋势；每个时间点可聚焦查看数值`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="40"
              x2="955"
              y1={35 + i * 45}
              y2={35 + i * 45}
              stroke="var(--color-border)"
              strokeDasharray="3 5"
            />
            <text
              x="30"
              y={39 + i * 45}
              textAnchor="end"
              fontSize="13"
              fill="var(--color-fg-mid)"
            >
              {Math.round(max * (1 - i / 3))}
            </text>
          </g>
        ))}
        <polygon
          points={`40,170 ${points} 955,170`}
          fill="var(--color-accent-soft)"
        />
        <polyline
          points={points}
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          fill="none"
        />
        {rows.map((r, i) => (
          <circle
            key={r.at}
            cx={x(i)}
            cy={y(r[series])}
            r={hover === i ? 5 : 9}
            fill={hover === i ? "var(--color-accent)" : "transparent"}
            tabIndex={0}
            aria-label={`${time(r.at)} ${r[series]} 次`}
            onFocus={() => setHover(i)}
            onMouseEnter={() => setHover(i)}
          >
            <title>{`${time(r.at)}：${r[series]} 次`}</title>
          </circle>
        ))}
        {[
          ...new Set([
            0,
            Math.floor(rows.length / 4),
            Math.floor(rows.length / 2),
            Math.floor((rows.length * 3) / 4),
            rows.length - 1,
          ]),
        ].map((i) => (
          <text
            key={i}
            x={x(i)}
            y="200"
            textAnchor={
              i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"
            }
            fontSize="13"
            fill="var(--color-fg-mid)"
          >
            {time(rows[i].at)}
          </text>
        ))}
      </svg>
    </Panel>
  );
}
function Heading({
  title,
  note,
  action,
}: {
  title: string;
  note?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && (
          <p className="text-[var(--color-fg-mid)] mt-1 text-xs">{note}</p>
        )}
      </div>
      {action}
    </div>
  );
}
export default function TelemetryDashboard({ initial }: { initial: Analysis }) {
  const [data, setData] = useState(initial);
  const [f, setF] = useState<Filters>(initial.filters);
  const [tab, setTab] = useState("overview");
  const [behavior, setBehavior] = useState("operations");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [metric, setMetric] = useState("LCP");
  const [errorType, setErrorType] = useState("all");
  const [errorKey, setErrorKey] = useState("");
  const [session, setSession] = useState("");
  const [environment, setEnvironment] = useState("device");
  const [technical, setTechnical] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError("");
    getTelemetryAnalysisAction({ ...f, session })
      .then((result) => {
        if (cancelled) return;
        if (result.status !== "ready") throw new Error("读取失败");
        setData(result.data);
        setBusy(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("未能更新遥测分析，下面保留上次成功查询的结果。");
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [f, session, refresh]);
  const update = (key: keyof Filters, value: string) => {
    setF((old) => ({ ...old, [key]: value }));
    setErrorKey("");
    setSession("");
    setShowAll(false);
  };
  const active = Object.entries(f).filter(([k, v]) => k !== "hours" && v);
  const totals = data.totals;
  const ranks = data.routes.filter((p) => p.label.includes(search));
  const selectedMetric = data.metrics.find((m) => m.key === metric)!;
  const hist = data.histograms.find((h) => h.metric === metric)!;
  const perf = data.performanceRoutes
    .filter((p) => p.metric === metric)
    .sort((a, b) => (b.p75 ?? 0) - (a.p75 ?? 0));
  const errors = data.errorGroups.filter(
    (e) => errorType === "all" || e.type === errorType,
  );
  const detail = data.errorGroups.find((e) => e.key === errorKey);
  const variants = data.variants.filter((v) => v.variant);
  const environmentRows =
    data.distributions[environment as keyof Analysis["distributions"]];
  return (
    <>
      <PageLayout
        variant="workbench"
        className="space-y-4 [&_tr]:border-[var(--color-border)] [&_td]:py-2.5 [&_th]:py-2.5"
      >
        <PageHeader
          title="遥测分析"
          description="从访问与使用行为，定位体验和操作中的问题。"
          actions={
            <div className="text-right text-xs text-[var(--color-fg-mid)]">
              <p>数据更新于 {time(data.meta.capturedAt, true)}</p>
              <p className="mt-1">
                {fmt(data.meta.batches)} 批 · {fmt(data.meta.totalReports)}{" "}
                条原始报告
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() => setRefresh((n) => n + 1)}
              >
                刷新分析
              </Button>
            </div>
          }
        />
        <Panel contentClassName="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Pick
              label="时间范围"
              value={f.hours}
              options={[
                { value: "6", label: "最近 6 小时" },
                { value: "24", label: "最近 24 小时" },
                { value: "168", label: "最近 7 天" },
              ]}
              onChange={(v) => update("hours", v || "24")}
            />
            <Pick
              label="工作范围"
              value={f.scope}
              options={[
                { value: "public", label: "前台页面" },
                { value: "admin", label: "管理后台" },
              ]}
              onChange={(v) => update("scope", v)}
            />
            <Pick
              label="赛事场景"
              value={f.scene}
              options={data.options.scene}
              onChange={(v) => update("scene", v)}
            />
            <Pick
              label="访问角色"
              value={f.role}
              options={data.options.role}
              onChange={(v) => update("role", v)}
            />
            <Pick
              label="页面"
              value={f.route}
              options={data.options.route}
              onChange={(v) => update("route", v)}
            />
            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 flex-1"
                onClick={() => setMore(!more)}
              >
                {more ? "收起条件" : "更多筛选"}{" "}
                {active.filter(([k]) =>
                  ["device", "browser", "source", "release"].includes(k),
                ).length || "＋"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  setF(blank);
                  setSession("");
                  setErrorKey("");
                }}
              >
                重置
              </Button>
            </div>
          </div>
          {more && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-4 md:grid-cols-4">
              <Pick
                label="设备"
                value={f.device}
                options={data.options.device}
                onChange={(v) => update("device", v)}
              />
              <Pick
                label="浏览器"
                value={f.browser}
                options={data.options.browser}
                onChange={(v) => update("browser", v)}
              />
              <Pick
                label="入口来源"
                value={f.source}
                options={data.options.source}
                onChange={(v) => update("source", v)}
              />
              <Pick
                label="部署版本"
                value={f.release}
                options={data.options.release}
                onChange={(v) => update("release", v)}
              />
            </div>
          )}
          {active.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {active.map(([k, v]) => (
                <Button
                  key={k}
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => update(k as keyof Filters, "")}
                >
                  {k === "scope"
                    ? v === "admin"
                      ? "管理后台"
                      : "前台页面"
                    : (data.options[k as keyof Analysis["options"]]?.find(
                        (o) => o.value === v,
                      )?.label ?? "筛选")}{" "}
                  ×
                </Button>
              ))}
            </div>
          )}
        </Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-mid)]">
          <span>
            {time(data.meta.from, true)} — {time(data.meta.capturedAt, true)} ·
            北京时间{" "}
            {data.meta.partial && (
              <span>· 实际保留数据始于 {time(data.meta.oldest)}</span>
            )}
            <Help text="时间范围按 D1 接收时间筛选，事件详情按客户端报告时间排序。所有分析页联动。设备、来源缺失单列为未采集；选择具体分类时只统计有该分类的事件。" />
          </span>
          <span role="status">
            {busy
              ? "正在重新计算…"
              : `已选 ${fmt(data.meta.selected)} 条去重事件 · 最近上报 ${data.meta.latest ? time(data.meta.latest) : "—"}`}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}
        {data.meta.truncated && (
          <p
            role="status"
            className="rounded-sm border border-[var(--color-border)] p-3 text-sm"
          >
            当前窗口超过查询预算，统计仅包含最新 {fmt(data.meta.batches)}{" "}
            批；部分分析数据不完整。
          </p>
        )}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">访问概览</TabsTrigger>
            <TabsTrigger value="behavior">使用行为</TabsTrigger>
            <TabsTrigger value="performance">页面性能</TabsTrigger>
            <TabsTrigger value="errors">
              异常与拒绝
              {totals.errors + totals.unknown > 0
                ? ` · ${totals.errors + totals.unknown}`
                : ""}
            </TabsTrigger>
            <TabsTrigger value="collection">采集状态</TabsTrigger>
          </TabsList>
          <div
            className={`mt-4 space-y-4 transition-opacity ${busy ? "opacity-50" : ""}`}
            aria-busy={busy}
          >
            <TabsContent value="overview" className="space-y-4">
              <Panel contentClassName="grid grid-cols-2 divide-x divide-[var(--color-border)] p-0 md:grid-cols-4">
                <Stat
                  label="页面访问"
                  value={totals.views}
                  note={`${data.routes.filter((r) => r.views).length} 类页面`}
                />
                <Stat
                  label="遥测会话"
                  value={totals.sessions}
                  help="同标签页的随机会话，30 分钟不活跃后更新。一个人可以有多个会话。"
                  note="按会话去重"
                />
                <Stat
                  label="登录账号"
                  value={totals.accounts}
                  help="按已签发票据中的产品账号标识去重，仅统计收到的报告。"
                  note="按账号去重"
                />
                <Stat
                  label="业务操作发起"
                  value={totals.starts}
                  note={`${totals.success} 成功 · ${totals.rejected} 业务拒绝`}
                />
              </Panel>
              <Trend rows={data.buckets} />
              <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <Panel contentClassName="p-0">
                  <Heading
                    title="访问页面"
                    note="点击页面联动所有分析"
                    action={
                      <Input
                        className="h-8 w-44"
                        placeholder="搜索页面名称…"
                        aria-label="搜索页面"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    }
                  />
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">页面</TableHead>
                        <TableHead className="text-right">访问</TableHead>
                        <TableHead className="text-right">会话</TableHead>
                        <TableHead className="text-right">访问占比</TableHead>
                        <TableHead className="pr-4 text-right">异常</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ranks.slice(0, showAll ? ranks.length : 8).map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="relative pl-4">
                            <span
                              className="absolute inset-y-1 left-0 bg-[var(--color-accent-soft)]"
                              style={{
                                width: `${(r.views / Math.max(1, ...ranks.map((p) => p.views))) * 85}%`,
                              }}
                            />
                            <button
                              className="relative w-full text-left hover:text-[var(--color-accent)]"
                              onClick={() => update("route", r.key)}
                            >
                              {r.label}{" "}
                              <span className="text-[var(--color-fg-mid)] ml-2">
                                ↗
                              </span>
                            </button>
                          </TableCell>
                          <TableCell className="tabular-nums text-right">
                            {r.views}
                          </TableCell>
                          <TableCell className="tabular-nums text-[var(--color-fg-mid)] text-right">
                            {r.sessions}
                          </TableCell>
                          <TableCell className="tabular-nums text-[var(--color-fg-mid)] text-right">
                            {r.share.toFixed(1)}%
                          </TableCell>
                          <TableCell
                            className={`tabular-nums pr-4 text-right ${r.errors ? "text-[var(--color-danger)]" : "text-[var(--color-fg-mid)]"}`}
                          >
                            {r.errors || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!ranks.length && <Empty />}
                  {ranks.length > 8 && (
                    <div className="border-t border-[var(--color-border)] p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowAll(!showAll)}
                      >
                        {showAll
                          ? "收起列表"
                          : `查看全部 ${ranks.length} 类页面`}{" "}
                        ↓
                      </Button>
                    </div>
                  )}
                </Panel>
                <div className="space-y-4">
                  <Panel contentClassName="p-0">
                    <Heading title="当前关注" />
                    <div className="divide-y divide-[var(--color-border)] px-4">
                      {[
                        {
                          label: "客户端与未知结果",
                          value: totals.errors + totals.unknown,
                          note: `影响 ${totals.affectedSessions} 个会话`,
                          next: "errors",
                        },
                        {
                          label: "业务拒绝",
                          value: totals.rejected,
                          note: "展开查看错误分类与相关操作",
                          next: "errors",
                        },
                        {
                          label: "未收到操作结果",
                          value: totals.pending,
                          note: "以本窗口发起的操作关联已接收结果",
                          next: "behavior",
                        },
                      ].map((r) => (
                        <button
                          key={r.label}
                          className="flex w-full items-center justify-between gap-3 py-3 text-left"
                          onClick={() => {
                            setTab(r.next);
                            setErrorType(
                              r.label === "业务拒绝" ? "rejected" : "all",
                            );
                          }}
                        >
                          <div>
                            <p className="text-sm">{r.label}</p>
                            <p className="text-[var(--color-fg-mid)] mt-1 text-xs">
                              {r.note}
                            </p>
                          </div>
                          <span className="tabular-nums text-xl">
                            {r.value}{" "}
                            <span className="text-[var(--color-fg-mid)] text-xs">
                              ↗
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Panel>
                  <Panel contentClassName="p-0">
                    <Heading
                      title="访问分布"
                      note={`设备信息覆盖 ${totals.clientCoverage} / ${totals.views} 次访问`}
                      action={
                        <Select
                          value={environment}
                          onValueChange={setEnvironment}
                        >
                          <SelectTrigger
                            className="h-8 w-24"
                            aria-label="分布维度"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[
                              ["device", "设备"],
                              ["browser", "浏览器"],
                              ["source", "入口来源"],
                              ["os", "系统"],
                              ["role", "角色"],
                              ["scene", "场景"],
                            ].map(([v, l]) => (
                              <SelectItem key={v} value={v}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      }
                    />
                    <div className="p-3">
                      <Distribution
                        rows={environmentRows}
                        onPick={
                          environment === "os"
                            ? undefined
                            : (v) => update(environment as keyof Filters, v)
                        }
                      />
                    </div>
                  </Panel>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="behavior" className="space-y-4">
              <Tabs value={behavior} onValueChange={setBehavior}>
                <TabsList>
                  <TabsTrigger value="operations">业务操作</TabsTrigger>
                  <TabsTrigger value="filters">筛选与导航</TabsTrigger>
                  <TabsTrigger value="sessions">会话路径</TabsTrigger>
                </TabsList>
                <TabsContent value="operations" className="mt-4 space-y-4">
                  <Panel contentClassName="grid grid-cols-2 divide-x divide-[var(--color-border)] p-0 md:grid-cols-4">
                    <Stat label="已发起" value={totals.starts} />
                    <Stat
                      label="已成功"
                      value={totals.success}
                      tone="text-[var(--color-success)]"
                    />
                    <Stat label="业务拒绝" value={totals.rejected} />
                    <Stat
                      label="未收到结果"
                      value={totals.pending}
                      note={`另有 ${totals.unknown} 次明确报告结果未知`}
                    />
                  </Panel>
                  <Panel contentClassName="p-0">
                    <Heading
                      title="操作结果与耗时"
                      note={
                        <span>
                          按本窗口发起的调用关联结果{" "}
                          <Help text="同账号、会话和调用标识关联开始与最新终态。结果可能出现在稍后的接收批次。未收到结果不代表业务失败；耗时仅统计已收到耗时的终态。" />
                        </span>
                      }
                    />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            "操作",
                            "发起",
                            "成功",
                            "拒绝",
                            "未知",
                            "未回报",
                            "平均耗时",
                            "P95",
                          ].map((l) => (
                            <TableHead key={l}>{l}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.operations.map((o) => (
                          <TableRow key={o.key}>
                            <TableCell>
                              <button
                                className="text-left hover:text-[var(--color-accent)]"
                                onClick={() => setTechnical(!technical)}
                              >
                                {o.label}
                              </button>
                              {technical && (
                                <p className="text-[var(--color-fg-mid)] mt-1 break-all font-mono text-xs">
                                  {o.key}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {o.start}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {o.success}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {o.rejected}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {o.unknown}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {o.pending}
                            </TableCell>
                            <TableCell className="tabular-nums whitespace-nowrap">
                              {metricValue(o.mean, "TIME")}
                            </TableCell>
                            <TableCell className="tabular-nums whitespace-nowrap">
                              {metricValue(o.p95, "TIME")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!data.operations.length && <Empty />}
                  </Panel>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Panel contentClassName="p-0">
                      <Heading title="操作子类型" note="按操作开始计数" />
                      <div className="space-y-2 p-4">
                        {variants.length ? (
                          variants.map((v) => (
                            <div
                              key={v.operation + v.variant}
                              className="flex justify-between gap-3 text-sm"
                            >
                              <span>
                                {v.label} · {v.variantLabel}
                              </span>
                              <span className="tabular-nums">{v.n}</span>
                            </div>
                          ))
                        ) : (
                          <Empty text="当前范围暂无已细分的操作。" />
                        )}
                      </div>
                    </Panel>
                    <Panel contentClassName="p-4">
                      <h2 className="text-sm font-semibold">结果覆盖</h2>
                      <p className="tabular-nums mt-4 text-3xl">
                        {totals.starts
                          ? totals.outcomeCoveragePct.toFixed(1) + "%"
                          : "—"}
                      </p>
                      <p className="text-[var(--color-fg-mid)] mt-2 text-xs">
                        本窗口发起且已收到终态的调用占比
                      </p>
                      <p className="text-[var(--color-fg-mid)] mt-4 text-xs">
                        另有 {totals.resultOnly}{" "}
                        条终态报告未匹配本筛选范围内的开始事件。
                      </p>
                    </Panel>
                  </div>
                </TabsContent>
                <TabsContent value="filters" className="mt-4 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Panel contentClassName="p-0">
                      <Heading
                        title="筛选使用"
                        note={`${totals.filter} 次筛选事件 · 一次事件可携带多个筛选维度`}
                      />
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>筛选项</TableHead>
                            <TableHead>选择</TableHead>
                            <TableHead className="text-right">次数</TableHead>
                            <TableHead className="text-right">会话</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.filterRows.map((r) => (
                            <TableRow key={r.dimension + r.value}>
                              <TableCell>{r.label}</TableCell>
                              <TableCell>{r.valueLabel}</TableCell>
                              <TableCell className="tabular-nums text-right">
                                {r.n}
                              </TableCell>
                              <TableCell className="tabular-nums text-right">
                                {r.sessions}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {!data.filterRows.length && <Empty />}
                    </Panel>
                    <Panel contentClassName="p-0">
                      <Heading title="页面导航方式" note="按页面访问事件计数" />
                      <div className="p-4">
                        <Distribution rows={data.navigation} />
                      </div>
                    </Panel>
                  </div>
                </TabsContent>
                <TabsContent value="sessions" className="mt-4">
                  <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.2fr]">
                    <Panel contentClassName="p-0">
                      <Heading
                        title="最近 100 个会话"
                        note="面板内编号 · 点击查看时间线"
                      />
                      <div className="max-h-[600px] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>会话</TableHead>
                              <TableHead>角色</TableHead>
                              <TableHead>访问 / 操作</TableHead>
                              <TableHead>最近时间</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.sessions.map((s) => (
                              <TableRow
                                key={s.key}
                                className={
                                  session === s.key ? "bg-secondary" : ""
                                }
                              >
                                <TableCell>
                                  <button
                                    className="hover:text-[var(--color-accent)]"
                                    onClick={() => setSession(s.key)}
                                  >
                                    {s.label}
                                  </button>
                                </TableCell>
                                <TableCell>{s.role}</TableCell>
                                <TableCell className="tabular-nums">
                                  {s.pages} / {s.actions}
                                </TableCell>
                                <TableCell className="tabular-nums text-[var(--color-fg-mid)] whitespace-nowrap text-xs">
                                  {time(s.last)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {!data.sessions.length && <Empty />}
                    </Panel>
                    <Panel contentClassName="p-0">
                      <Heading
                        title={
                          data.sessions.find((s) => s.key === session)?.label ??
                          "会话时间线"
                        }
                        note="按报告时间排序 · 最多显示 100 条非性能事件"
                      />
                      {session ? (
                        <div className="max-h-[600px] space-y-0 overflow-auto p-4">
                          {data.timeline.map((e, i) => (
                            <div
                              key={i}
                              className="flex gap-3 border-l border-[var(--color-border)] pb-5 pl-4"
                            >
                              <time className="tabular-nums text-[var(--color-fg-mid)] shrink-0 text-xs">
                                {time(e.at).slice(-5)}
                              </time>
                              <div>
                                <p className="text-sm">
                                  {e.label}{" "}
                                  {e.phase && (
                                    <span className="text-[var(--color-fg-mid)] text-xs">
                                      · {e.phase}
                                    </span>
                                  )}
                                </p>
                                <p className="text-[var(--color-fg-mid)] mt-1 text-xs">
                                  {e.detail || e.route}
                                  {e.duration !== null
                                    ? ` · ${metricValue(e.duration, "TIME")}`
                                    : ""}
                                </p>
                                {e.requestId && (
                                  <details className="text-[var(--color-fg-mid)] mt-2 text-xs">
                                    <summary>排查编号</summary>
                                    <code>{e.requestId}</code>
                                  </details>
                                )}
                              </div>
                            </div>
                          ))}
                          {!data.timeline.length && <Empty />}
                        </div>
                      ) : (
                        <Empty text="选择左侧会话，查看页面访问、筛选与操作结果。" />
                      )}
                    </Panel>
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>
            <TabsContent value="performance" className="space-y-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                {data.metrics.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    className={`rounded-sm border p-4 text-left transition-colors ${metric === m.key ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] bg-[var(--color-panel)] hover:bg-secondary"}`}
                  >
                    <p className="text-[var(--color-fg-mid)] text-xs">
                      {m.label} · P75
                    </p>
                    <p className="tabular-nums mt-2 text-xl font-semibold">
                      {metricValue(m.p75, m.key)}
                    </p>
                    <p className="text-[var(--color-fg-mid)] mt-2 text-xs">
                      {m.n} 个样本
                    </p>
                  </button>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <Panel contentClassName="p-0">
                  <Heading
                    title={`${metricLabels[metric]}分布`}
                    note={
                      <span>
                        去重样本的最新已上报值{" "}
                        <Help text="按账号、会话和随机指标标识选报告时间最新值，再以 nearest-rank 计算 P50/P75/P95。长开页面可能继续更新，指标缺失不补零。" />
                      </span>
                    }
                  />
                  <div className="grid grid-cols-2 divide-x divide-[var(--color-border)] sm:grid-cols-4">
                    <Stat
                      label="P50"
                      value={metricValue(selectedMetric.p50, metric)}
                    />
                    <Stat
                      label="P75"
                      value={metricValue(selectedMetric.p75, metric)}
                    />
                    <Stat
                      label="P95"
                      value={metricValue(selectedMetric.p95, metric)}
                    />
                    <Stat label="样本数" value={selectedMetric.n} />
                  </div>
                  <div className="space-y-3 p-5">
                    {hist.counts.map((n, i) => {
                      const hi = hist.bounds[i];
                      const lo = hist.bounds[i - 1];
                      const l =
                        i === 0
                          ? `≤ ${metricValue(hi, metric)}`
                          : i === hist.bounds.length
                            ? `> ${metricValue(lo, metric)}`
                            : `${metricValue(lo, metric)} – ${metricValue(hi, metric)}`;
                      return (
                        <div
                          key={i}
                          className="grid grid-cols-[140px_1fr_60px] items-center gap-3 text-xs"
                        >
                          <span className="text-[var(--color-fg-mid)] tabular-nums">
                            {l}
                          </span>
                          <div className="h-5 overflow-hidden rounded-sm bg-secondary">
                            <div
                              className="h-full bg-[var(--color-accent)]"
                              style={{
                                width: `${(n / Math.max(1, ...hist.counts)) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="tabular-nums text-right">{n}</span>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
                <Panel contentClassName="p-0">
                  <Heading title="按设备比较" note="与全局筛选条件联动" />
                  <div className="p-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>设备</TableHead>
                          <TableHead>P75</TableHead>
                          <TableHead className="text-right">样本数</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.options.device.map((d) => {
                          const rows = data.metricDevices.filter(
                            (s) => s.metric === metric && s.device === d.value,
                          );
                          return rows.length ? (
                            <TableRow key={d.value}>
                              <TableCell>
                                <button
                                  onClick={() => update("device", d.value)}
                                >
                                  {d.label} ↗
                                </button>
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {metricValue(rows[0].p75, metric)}
                              </TableCell>
                              <TableCell className="tabular-nums text-right">
                                {rows.reduce((n, r) => n + r.n, 0)}
                              </TableCell>
                            </TableRow>
                          ) : null;
                        })}
                      </TableBody>
                    </Table>
                    <p className="text-[var(--color-fg-mid)] mt-4 text-xs">
                      各设备基于原始样本独立计算分位数。
                    </p>
                  </div>
                </Panel>
              </div>
              <Panel contentClassName="p-0">
                <Heading
                  title="页面性能排行"
                  note="按 P75 从高到低 · 点击页面联动筛选"
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["页面", "P50", "P75", "P95", "平均值", "样本数"].map(
                        (l) => (
                          <TableHead key={l}>{l}</TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perf.map((p) => (
                      <TableRow key={p.route}>
                        <TableCell>
                          <button
                            className="hover:text-[var(--color-accent)]"
                            onClick={() => update("route", p.route)}
                          >
                            {p.label} ↗
                          </button>
                        </TableCell>
                        <TableCell className="tabular-nums whitespace-nowrap">
                          {metricValue(p.p50, metric)}
                        </TableCell>
                        <TableCell className="tabular-nums whitespace-nowrap font-medium">
                          {metricValue(p.p75, metric)}
                        </TableCell>
                        <TableCell className="tabular-nums whitespace-nowrap">
                          {metricValue(p.p95, metric)}
                        </TableCell>
                        <TableCell className="tabular-nums text-[var(--color-fg-mid)] whitespace-nowrap">
                          {metricValue(p.mean, metric)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {p.n}
                          {p.n < 10 && (
                            <span className="text-[var(--color-fg-mid)] ml-2 text-xs">
                              少量样本
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!perf.length && (
                  <Empty text="当前筛选下暂无可去重的性能样本。" />
                )}
              </Panel>
              <Panel contentClassName="p-0">
                <Heading
                  title="版本与设备比较"
                  note="同一筛选窗口中的观测值 · 每行单独计算"
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["部署版本", "设备", "P50", "P75", "P95", "样本数"].map(
                        (l) => (
                          <TableHead key={l}>{l}</TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.metricSegments
                      .filter((r) => r.metric === metric)
                      .sort((a, b) => (b.p75 ?? 0) - (a.p75 ?? 0))
                      .map((r) => (
                        <TableRow key={r.device + r.release}>
                          <TableCell>
                            <button
                              onClick={() => {
                                update("release", r.release);
                                setMore(true);
                              }}
                              className="tabular-nums hover:text-[var(--color-accent)]"
                            >
                              版本 {r.release.slice(0, 7)} ↗
                            </button>
                          </TableCell>
                          <TableCell>{cat(r.device)}</TableCell>
                          <TableCell className="tabular-nums">
                            {metricValue(r.p50, metric)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {metricValue(r.p75, metric)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {metricValue(r.p95, metric)}
                          </TableCell>
                          <TableCell className="tabular-nums">{r.n}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Panel>
              <details className="text-[var(--color-fg-mid)] text-xs">
                <summary className="cursor-pointer">
                  查看性能样本与计算口径
                </summary>
                <p className="mt-3 leading-6">
                  当前范围包含 {totals.performance} 个可去重性能样本、
                  {totals.legacyPerformance}{" "}
                  条缺少可信样本标识的旧版报告。旧版报告仅计入采集量。分位数基于最新已收到的观测值；指标样本不等同于页面访问数。页面切换测量到路由提交为止，主要内容加载反映浏览器可报告的导航。
                </p>
              </details>
            </TabsContent>
            <TabsContent value="errors" className="space-y-4">
              <Panel contentClassName="grid grid-cols-2 divide-x divide-[var(--color-border)] p-0 md:grid-cols-4">
                <Stat label="客户端异常" value={totals.errors} />
                <Stat label="操作结果未知" value={totals.unknown} />
                <Stat
                  label="受异常影响的会话"
                  value={totals.affectedSessions}
                />
                <Stat
                  label="业务拒绝报告"
                  value={data.errorGroups
                    .filter((e) => e.type === "rejected")
                    .reduce((n, e) => n + e.n, 0)}
                  help="拒绝报告按收到的终态计数。业务操作页按本窗口发起的调用关联结果，两个口径可能不同。"
                />
              </Panel>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "全部分类"],
                  ["client", "客户端异常"],
                  ["unknown", "结果未知"],
                  ["rejected", "业务拒绝"],
                ].map(([v, l]) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={errorType === v ? "secondary" : "outline"}
                    onClick={() => {
                      setErrorType(v);
                      setErrorKey("");
                    }}
                  >
                    {l}
                  </Button>
                ))}
              </div>
              <div
                className={`grid items-start gap-4 ${detail ? "xl:grid-cols-[1.2fr_1fr]" : ""}`}
              >
                <Panel contentClassName="p-0">
                  <Heading title="问题分组" note="按页面、操作及错误分类归并" />
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>问题与位置</TableHead>
                        <TableHead>报告</TableHead>
                        <TableHead>会话</TableHead>
                        <TableHead>最近发生</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {errors.map((e) => (
                        <TableRow
                          key={e.key}
                          className={e.key === errorKey ? "bg-secondary" : ""}
                        >
                          <TableCell>
                            <button
                              className="text-left hover:text-[var(--color-accent)]"
                              onClick={() => setErrorKey(e.key)}
                            >
                              <span
                                className={
                                  e.type === "rejected"
                                    ? ""
                                    : "text-[var(--color-danger)]"
                                }
                              >
                                {e.reason}
                              </span>
                              <span className="text-[var(--color-fg-mid)] mt-1 block text-xs">
                                {e.label} · {e.operationLabel}
                              </span>
                            </button>
                          </TableCell>
                          <TableCell className="tabular-nums">{e.n}</TableCell>
                          <TableCell className="tabular-nums">
                            {e.sessions}
                          </TableCell>
                          <TableCell className="tabular-nums text-[var(--color-fg-mid)] whitespace-nowrap text-xs">
                            {time(e.last)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!errors.length && (
                    <Empty text="当前筛选下暂无此类问题报告。" />
                  )}
                </Panel>
                {detail && (
                  <Panel contentClassName="p-0">
                    <Heading
                      title={detail.reason}
                      action={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setErrorKey("")}
                        >
                          关闭
                        </Button>
                      }
                    />
                    <div className="space-y-4 p-4">
                      <p className="text-sm">
                        {detail.label} · {detail.operationLabel}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => update("route", detail.route)}
                        >
                          筛选此页面
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            update("route", detail.route);
                            setTab("performance");
                          }}
                        >
                          查看页面性能
                        </Button>
                      </div>
                      <details className="text-xs text-[var(--color-fg-mid)]">
                        <summary className="cursor-pointer">技术详情</summary>
                        <dl className="mt-3 space-y-2 break-all font-mono">
                          <div>错误码：{detail.code || "—"}</div>
                          <div>路由：{detail.route}</div>
                          {detail.operation && (
                            <div>操作：{detail.operation}</div>
                          )}
                        </dl>
                      </details>
                      <div className="border-t border-[var(--color-border)] pt-3">
                        <h3 className="mb-3 text-sm font-semibold">最近报告</h3>
                        {detail.details.map((e, i) => (
                          <div
                            key={i}
                            className="mb-4 border-l border-[var(--color-border)] pl-3"
                          >
                            <p className="text-[var(--color-fg-mid)] tabular-nums text-xs">
                              {time(e.at, true)} · {e.role}
                            </p>
                            <button
                              className="mt-1 text-sm hover:text-[var(--color-accent)]"
                              onClick={() => {
                                setSession(e.session);
                                setTab("behavior");
                                setBehavior("sessions");
                              }}
                            >
                              {e.sessionLabel} · 查看路径 ↗
                            </button>
                            <p className="text-[var(--color-fg-mid)] mt-1 text-xs">
                              部署版本 {e.release.slice(0, 7)}
                            </p>
                            {e.requestId ? (
                              <details className="mt-2 break-all text-xs text-[var(--color-fg-mid)]">
                                <summary>排查编号</summary>
                                <code>{e.requestId}</code>
                              </details>
                            ) : (
                              <p className="text-[var(--color-fg-mid)] mt-1 text-xs">
                                未附排查编号
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Panel>
                )}
              </div>
            </TabsContent>
            <TabsContent value="collection" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Panel contentClassName="p-5">
                  <h2 className="text-sm font-semibold">数据范围</h2>
                  <dl className="mt-5 space-y-3 text-sm">
                    {[
                      ["数据来源", "生产遥测 · 分析结果与接收用量"],
                      ["查询时间", time(data.meta.capturedAt, true)],
                      ["最早保留报告", time(data.meta.oldest, true)],
                      [
                        "读取批次",
                        `${fmt(data.meta.batches)} 批 · 本次读取范围`,
                      ],
                      ["原始报告", `${fmt(data.meta.totalReports)} 条`],
                      ["按事件标识去重后", `${fmt(data.meta.uniqueEvents)} 条`],
                      ["当前筛选", `${fmt(data.meta.selected)} 条`],
                    ].map(([l, v]) => (
                      <div key={l} className="flex justify-between gap-4">
                        <dt className="text-[var(--color-fg-mid)]">{l}</dt>
                        <dd className="tabular-nums text-right">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {data.meta.partial && (
                    <p className="mt-4 text-xs text-[var(--color-warning)]">
                      当前窗口早于最早可用报告，统计使用已读取的报告。
                    </p>
                  )}
                </Panel>
                <Panel contentClassName="p-5">
                  <h2 className="text-sm font-semibold">信息覆盖</h2>
                  <p className="tabular-nums mt-5 text-4xl font-semibold">
                    {totals.clientCoveragePct.toFixed(1)}
                    <span className="text-[var(--color-fg-mid)] text-lg">
                      %
                    </span>
                  </p>
                  <p className="text-[var(--color-fg-mid)] mt-2 text-xs">
                    当前筛选中，携带设备与入口分类的页面访问
                  </p>
                  <div className="my-4 h-2 overflow-hidden rounded-sm bg-secondary">
                    <div
                      className="h-full bg-[var(--color-accent)]"
                      style={{ width: `${totals.clientCoveragePct}%` }}
                    />
                  </div>
                  <p className="text-sm">
                    已采集 {totals.clientCoverage} 次 · 未采集{" "}
                    {totals.views - totals.clientCoverage} 次
                  </p>
                  <p className="text-[var(--color-fg-mid)] mt-5 text-xs leading-6">
                    设备、浏览器和来源分布将缺失值单列。来源仅有固定类别；未提供来源表示浏览器没有可用的来源信息。
                  </p>
                  <p className="text-[var(--color-fg-mid)] mt-3 text-xs">
                    缺少样本标识的性能报告：{totals.legacyPerformance} 条
                  </p>
                </Panel>
              </div>
              <Panel contentClassName="p-0">
                <Heading
                  title="接收用量"
                  note="全站独立指标 · 不受上方事件筛选影响 · 按 UTC 自然日计量"
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>接收日期 · UTC</TableHead>
                      <TableHead>批次</TableHead>
                      <TableHead>批次预算使用</TableHead>
                      <TableHead>正文大小</TableHead>
                      <TableHead>正文预算使用</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.usage.usage.map((r) => (
                      <TableRow key={r.day}>
                        <TableCell>{r.day}</TableCell>
                        <TableCell className="tabular-nums">
                          {r.batches} / {fmt(data.usage.budget.batches)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {(
                            (r.batches / data.usage.budget.batches) *
                            100
                          ).toFixed(1)}
                          %
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {(r.bytes / 1048576).toFixed(3)} MiB
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {((r.bytes / data.usage.budget.bytes) * 100).toFixed(
                            1,
                          )}
                          % / {fmt(data.usage.budget.bytes / 1048576)} MiB
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-[var(--color-fg-mid)] p-4 text-xs">
                  待清理到期批次：{data.usage.expiredBatches} ·
                  正文大小按未压缩字节统计
                </p>
              </Panel>
            </TabsContent>
          </div>
        </Tabs>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-fg-mid)]">
          <span>生产遥测 · 北京时间</span>
          <details>
            <summary className="cursor-pointer">数据与展示说明</summary>
            <p className="mt-3 max-w-2xl leading-6">
              面板读取保留期内的生产遥测。会话使用独立排查标识，账号只参与去重计数。部署版本使用提交短号；错误码、路由及排查编号在详情中查看。
            </p>
          </details>
        </footer>
      </PageLayout>
    </>
  );
}
