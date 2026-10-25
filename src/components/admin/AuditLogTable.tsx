"use client";

import React, { useRef, useTransition } from "react";
import { AuditLogDetailDialog } from "./AuditLogDetailDialog";

import { ClearFilters, ListSearchField, ListToolbar, PaginationControls, ResultSummary, type ListSearchFieldHandle, useListQueryParams } from "@/components/rivalhub";
import { formatCST } from "@/lib/utils/date";
import {
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
const AUDIT_QUERY_DEFAULTS = {
  action: "",
  actor: "",
  seasonId: "",
  dateFrom: "",
  dateTo: "",
} as const;
const ACTION_FILTER_OPTIONS = getAuditActionFilterOptions();
const ACTION_FILTER_GROUPS = ACTION_FILTER_OPTIONS.reduce<Array<{ label: string; options: typeof ACTION_FILTER_OPTIONS }>>((groups, option) => {
  const group = groups.find((candidate) => candidate.label === option.categoryLabel);
  if (group) group.options.push(option);
  else groups.push({ label: option.categoryLabel, options: [option] });
  return groups;
}, []);

export function AuditLogTable({ initialLogs, initialTotal, seasons, routeBase = "/admin/logs", seasonScopeId }: Props) {
  const { searchParams, update: navigate } = useListQueryParams({ routeBase, defaults: AUDIT_QUERY_DEFAULTS });
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  const [isPending, startTransition] = useTransition();

  const logs = initialLogs;
  const total = initialTotal;
  const update: typeof navigate = (...args) => startTransition(() => navigate(...args));

  const pageValue = Number(searchParams.get("page") ?? "1");
  const requestedPage = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const currentPage = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const currentAction = searchParams.get("action") ?? "";
  const currentActor = searchParams.get("actor") ?? "";
  const currentSeason = searchParams.get("seasonId") ?? "";
  const currentDateFrom = searchParams.get("dateFrom") ?? "";
  const currentDateTo = searchParams.get("dateTo") ?? "";

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-w-0 space-y-4">
      <ListToolbar className="items-start">
        <div className="min-w-0 w-full sm:flex-1 sm:basis-[calc(50%-0.75rem)] lg:basis-[30%]">
          <label htmlFor="audit-action-filter" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
            操作类型
          </label>
          <select
            id="audit-action-filter"
            value={currentAction}
            onChange={(event) => update({ action: event.target.value })}
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

        <ListSearchField
          ref={searchFieldRef}
          queryKey="actor"
          label="操作人"
          placeholder="用户 ID 或邮箱"
          value={currentActor}
          onDebouncedChange={(value) => update({ actor: value })}
          debounceMs={400}
          className="w-full sm:flex-1 sm:basis-[calc(50%-0.75rem)] lg:basis-[30%]"
        />

        <div className="min-w-0 w-full sm:flex-1 sm:basis-[calc(50%-0.75rem)] lg:basis-[30%]">
          <label htmlFor="audit-season-filter" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
            赛季
          </label>
          <select
            id="audit-season-filter"
            value={currentSeason}
            onChange={(event) => update({ seasonId: event.target.value })}
            className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
            style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >
            <option value="">全部赛季</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </div>

        <div className="flex min-w-0 w-full flex-wrap gap-3 lg:col-span-6">
          <div className="min-w-0 flex-1 basis-full sm:basis-[calc(50%-0.75rem)]">
            <label htmlFor="audit-date-from" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
              起始日期
            </label>
            <input
              id="audit-date-from"
              type="date"
              value={currentDateFrom}
              onChange={(event) => update({ dateFrom: event.target.value })}
              className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
              style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
            />
          </div>
          <div className="min-w-0 flex-1 basis-full sm:basis-[calc(50%-0.75rem)]">
            <label htmlFor="audit-date-to" className="mb-1 block text-xs" style={{ color: "var(--color-fg-dim)" }}>
              结束日期
            </label>
            <input
              id="audit-date-to"
              type="date"
              value={currentDateTo}
              onChange={(event) => update({ dateTo: event.target.value })}
              className="min-w-0 max-w-full w-full rounded px-2 py-1.5 text-xs"
              style={{ background: "var(--color-panel-low)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
            />
          </div>
        </div>
        <ClearFilters
          defaults={AUDIT_QUERY_DEFAULTS}
          searchParams={searchParams}
          onClear={(updates) => {
            searchFieldRef.current?.reset();
            update(updates);
          }}
        />
      </ListToolbar>

      <div className="flex items-center justify-between gap-3">
        <ResultSummary total={total} page={currentPage} pageSize={PAGE_SIZE} totalPages={totalPages} />
        {isPending && <span className="text-xs text-[var(--color-accent)]">加载中…</span>}
      </div>

      <div className="min-w-0 overflow-x-auto rounded-sm" style={{ border: "1px solid var(--color-border)" }}>
        <table className="w-full min-w-[900px] table-fixed text-xs" style={{ fontFamily: "var(--font-mono)" }}>
          <colgroup>
            <col className="w-[160px]" /><col className="w-[180px]" /><col className="w-[140px]" /><col className="w-[28%]" /><col />
          </colgroup>
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
              return (
                <tr key={log.id} className="group" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="whitespace-nowrap px-3 py-2" style={{ color: "var(--color-fg-mid)" }}>{formatCST(log.createdAt)}</td>
                  <td className="break-words px-3 py-2">
                    <span
                      className="mr-1.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: log.categoryColor, color: "var(--color-bg)", opacity: 0.9 }}
                    >
                      {log.categoryLabel}
                    </span>
                    <AuditLogDetailDialog log={log} seasonScopeId={seasonScopeId} />
                    {log.seasonLabel && !seasonScopeId && <span className="mt-1 block text-[var(--color-fg-dim)]">{log.seasonLabel}</span>}
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

      <PaginationControls
        page={currentPage}
        totalPages={totalPages}
        onPageChange={(page) => update({ page }, { defaults: { page: 1 }, history: "push" })}
      />
    </div>
  );
}
