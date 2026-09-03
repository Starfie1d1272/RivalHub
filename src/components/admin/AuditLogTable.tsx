"use client";

import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchAuditLogs, type AuditLogFilters } from "@/actions/audit";
import { formatCST } from "@/lib/utils/date";
import {
  AUDIT_LOG_LOAD_ERROR_MESSAGE,
  getAuditActionFilterOptions,
  getAuditActionPresentation,
  type AuditLogView,
} from "@/lib/audit/presentation";

interface Props {
  initialLogs: AuditLogView[];
  initialTotal: number;
  seasons: { id: string; name: string }[];
  routeBase?: string;
  seasonScopeId?: string;
}

const PAGE_SIZE = 50;
const ACTION_FILTER_OPTIONS = getAuditActionFilterOptions();
const ACTION_FILTER_GROUPS = ACTION_FILTER_OPTIONS.reduce<Array<{ label: string; options: typeof ACTION_FILTER_OPTIONS }>>((groups, option) => {
  const group = groups.find((candidate) => candidate.label === option.categoryLabel);
  if (group) group.options.push(option);
  else groups.push({ label: option.categoryLabel, options: [option] });
  return groups;
}, []);

export function AuditLogTable({ initialLogs, initialTotal, seasons, routeBase = "/admin/logs", seasonScopeId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [logs, setLogs] = useState(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localActor, setLocalActor] = useState(searchParams.get("actor") ?? "");
  const actorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const currentPage = Number(searchParams.get("page") ?? "1");
  const currentAction = searchParams.get("action") ?? "";
  const currentActor = searchParams.get("actor") ?? "";
  const currentSeason = searchParams.get("seasonId") ?? "";
  const currentDateFrom = searchParams.get("dateFrom") ?? "";
  const currentDateTo = searchParams.get("dateTo") ?? "";

  useEffect(() => {
    setLocalActor(currentActor);
  }, [currentActor]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      if (!updates.page) params.set("page", "1");
      router.push(`${routeBase}?${params.toString()}` as never);
    },
    [routeBase, router, searchParams],
  );

  const debouncedUpdateParam = useCallback(
    (key: string, value: string, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => updateParams({ [key]: value }), 400);
    },
    [updateParams],
  );

  const reload = useCallback(() => {
    const filters: AuditLogFilters = { page: currentPage, pageSize: PAGE_SIZE };
    if (currentAction) filters.action = currentAction;
    if (currentActor) filters.actorId = currentActor;
    if (currentSeason) filters.seasonId = currentSeason;
    if (currentDateFrom) filters.dateFrom = currentDateFrom;
    if (currentDateTo) filters.dateTo = currentDateTo;
    if (seasonScopeId) filters.seasonScopeId = seasonScopeId;

    setLoadError(null);
    startTransition(async () => {
      try {
        const result = await fetchAuditLogs(filters);
        if (!result.success) {
          setLoadError(AUDIT_LOG_LOAD_ERROR_MESSAGE);
          return;
        }
        setLogs(result.data.logs);
        setTotal(result.data.total);
      } catch {
        setLoadError(AUDIT_LOG_LOAD_ERROR_MESSAGE);
      }
    });
  }, [currentAction, currentActor, currentDateFrom, currentDateTo, currentPage, currentSeason, seasonScopeId, startTransition]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    reload();
  }, [reload]);

  useEffect(() => {
    const actorTimer = actorTimerRef.current;
    return () => clearTimeout(actorTimer);
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-w-0 space-y-4">
      <div
        className="grid min-w-0 grid-cols-1 gap-3 rounded-sm p-4 sm:grid-cols-2 lg:grid-cols-6"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}
      >
        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="audit-action-filter" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
            操作类型
          </label>
          <select
            id="audit-action-filter"
            value={currentAction}
            onChange={(event) => updateParams({ action: event.target.value })}
            className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
            style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >
            <option value="">全部操作</option>
            {currentAction && !ACTION_FILTER_OPTIONS.some((option) => option.value === currentAction) && (
              <option value={currentAction}>{getAuditActionPresentation(currentAction).label}</option>
            )}
            {ACTION_FILTER_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="audit-actor-filter" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
            操作人
          </label>
          <input
            id="audit-actor-filter"
            type="text"
            placeholder="用户 ID 或邮箱"
            value={localActor}
            onChange={(event) => {
              setLocalActor(event.target.value);
              debouncedUpdateParam("actor", event.target.value, actorTimerRef);
            }}
            className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
            style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="audit-season-filter" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
            赛季
          </label>
          <select
            id="audit-season-filter"
            value={currentSeason}
            onChange={(event) => updateParams({ seasonId: event.target.value })}
            className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
            style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >
            <option value="">全部赛季</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-6">
          <div className="min-w-0">
            <label htmlFor="audit-date-from" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
              起始日期
            </label>
            <input
              id="audit-date-from"
              type="date"
              value={currentDateFrom}
              onChange={(event) => updateParams({ dateFrom: event.target.value })}
              className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
              style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="audit-date-to" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
              结束日期
            </label>
            <input
              id="audit-date-to"
              type="date"
              value={currentDateTo}
              onChange={(event) => updateParams({ dateTo: event.target.value })}
              className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
              style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
            />
          </div>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-sm px-3 py-2 text-xs"
          style={{ background: "color-mix(in srgb, var(--color-danger) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)", color: "var(--color-danger)" }}
        >
          <span>{loadError}</span>
          <button type="button" onClick={reload} className="underline underline-offset-2">重试</button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-fg-dim)" }}>
        <span>共 {total} 条记录{totalPages > 1 ? `，第 ${currentPage}/${totalPages} 页` : ""}</span>
        {isPending && <span style={{ color: "var(--color-accent)" }}>加载中…</span>}
      </div>

      <div className="min-w-0 overflow-x-auto rounded-sm" style={{ border: "1px solid var(--color-border)" }}>
        <table className="w-full min-w-[760px] text-xs" style={{ fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--color-panel)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium" style={{ color: "var(--color-fg-mid)" }}>时间</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--color-fg-mid)" }}>操作</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--color-fg-mid)" }}>操作人</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--color-fg-mid)" }}>目标</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--color-fg-mid)" }}>摘要</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center" style={{ color: "var(--color-fg-dim)" }}>暂无日志记录</td>
              </tr>
            )}
            {logs.map((log) => {
              const action = getAuditActionPresentation(log.actionKey);
              return (
                <tr key={log.id} className="group" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="whitespace-nowrap px-3 py-2" style={{ color: "var(--color-fg-mid)" }}>{formatCST(log.createdAt)}</td>
                  <td className="break-words px-3 py-2">
                    <span
                      className="mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: log.categoryColor, color: "var(--color-bg)", opacity: 0.9 }}
                    >
                      {log.categoryLabel}
                    </span>
                    <span title={action.known ? undefined : `内部键：${log.actionKey}`} style={{ color: "var(--color-fg)" }}>
                      {log.actionLabel}
                    </span>
                  </td>
                  <td className="max-w-[180px] break-words px-3 py-2" style={{ color: "var(--color-fg-mid)" }}>{log.actorLabel}</td>
                  <td className="break-words px-3 py-2" style={{ color: "var(--color-fg-mid)" }}>
                    <span className="mr-1 opacity-60">{log.targetTypeLabel}</span>
                    <span>{log.targetLabel}</span>
                  </td>
                  <td className="break-words px-3 py-2" style={{ color: "var(--color-fg-mid)" }}>{log.summary ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={currentPage <= 1}
            onClick={() => updateParams({ page: String(currentPage - 1) })}
            className="rounded px-3 py-1 text-xs disabled:opacity-30"
            style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >上一页</button>
          <span className="text-xs" style={{ color: "var(--color-fg-dim)" }}>{currentPage} / {totalPages}</span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => updateParams({ page: String(currentPage + 1) })}
            className="rounded px-3 py-1 text-xs disabled:opacity-30"
            style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >下一页</button>
        </div>
      )}
    </div>
  );
}
