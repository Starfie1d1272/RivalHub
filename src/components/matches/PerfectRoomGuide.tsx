"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type {
  PerfectRoomGuideData,
  PerfectRoomGuideField,
} from "@/lib/admin/matches/operator-workflow";

function GuideCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-panel)] px-3.5 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

function GuideRow({
  label,
  alignTop,
  children,
}: {
  label: string;
  alignTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-x-3",
        alignTop ? "md:items-start" : "md:items-center",
      )}
    >
      <div
        className={cn(
          "text-xs font-medium text-[var(--color-fg-essential)] md:text-right",
          alignTop && "md:pt-2.5",
        )}
      >
        {label}：
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
        {children}
      </div>
    </div>
  );
}

export function PerfectRoomGuide({ guide }: { guide: PerfectRoomGuideData }) {
  const { fields } = guide;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制`);
    } catch {
      toast.error("复制失败，请手动复制。");
    }
  }

  function renderFieldBox(
    field: PerfectRoomGuideField,
    options?: { inlineLabel?: string; className?: string },
  ) {
    const isMissing = field.value === null;
    const isDefault = !isMissing && field.tone === "default";
    const isWarn = isMissing || field.tone === "warn";

    return (
      <div
        className={cn(
          "flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 py-1.5",
          isWarn
            ? "border border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] text-[var(--color-fg)]"
            : isDefault
              ? "border border-dashed border-[var(--color-border)] bg-[var(--color-bg)]/50 text-[var(--color-fg-mid)]"
              : "border border-[var(--color-border-control)] bg-[var(--color-panel-hi)] text-[var(--color-fg)]",
          options?.className,
        )}
      >
        <div className="min-w-0 flex-1">
          {options?.inlineLabel && (
            <span className="block text-[11px] leading-tight text-[var(--color-fg-mid)]">
              {options.inlineLabel}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "min-w-0 text-sm [overflow-wrap:anywhere] select-text",
                isMissing && "text-[var(--color-warn)]",
                !isMissing && !isDefault && "font-medium",
              )}
            >
              {field.value ?? "待核对赛程配置"}
            </span>
            {field.badge && (
              <span
                className={cn(
                  "shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium leading-none",
                  isWarn
                    ? "border border-[var(--color-warn-edge)] text-[var(--color-warn)]"
                    : "border border-[var(--color-border)] text-[var(--color-fg-mid)]",
                )}
              >
                {field.badge}
              </span>
            )}
          </div>
        </div>
        {field.copyable && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 px-2.5 text-xs"
            disabled={isMissing}
            aria-label={`复制${field.label}`}
            onClick={() => field.value !== null && void copy(field.label, field.value)}
          >
            复制
          </Button>
        )}
      </div>
    );
  }

  function renderTeamRow(team: PerfectRoomGuideField, coach: PerfectRoomGuideField) {
    return (
      <GuideRow label={team.label}>
        {renderFieldBox(team, { className: "md:col-span-5" })}
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5 md:col-span-7">
          <span className="shrink-0 text-xs font-medium text-[var(--color-fg-mid)]">
            {coach.label}：
          </span>
          {renderFieldBox(coach, { className: "w-full sm:max-w-[15rem]" })}
        </div>
      </GuideRow>
    );
  }

  function renderNote(field: PerfectRoomGuideField, className: string) {
    if (!field.note) return null;
    return (
      <p
        className={cn(
          "text-xs",
          field.tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-fg-mid)]",
          className,
        )}
      >
        {field.note}
      </p>
    );
  }

  return (
    <section
      aria-label={`Map ${guide.mapOrder} Perfect 建房指引`}
      className="space-y-2.5 border-t border-[var(--color-border)] pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-medium">Perfect 建房</h3>
          <p className="text-xs text-[var(--color-fg-mid)]">
            按「创建团队赛」后台分区与位置一一对应；直接选单图，无需在后台重复 BP。
          </p>
        </div>
        <Button asChild size="sm">
          <a href="https://match.wmpvp.com/" target="_blank" rel="noopener noreferrer">
            打开后台 ↗
          </a>
        </Button>
      </div>

      <div className="space-y-2">
        <GuideCard>
          <GuideRow label={fields.season.label} alignTop>
            {renderFieldBox(fields.season, {
              inlineLabel: "选择本届赛事",
              className: "md:col-span-6",
            })}
            {renderFieldBox(fields.round, {
              inlineLabel: fields.round.label,
              className: "md:col-span-5",
            })}
            {renderFieldBox(fields.description, {
              inlineLabel: fields.description.label,
              className: "md:col-span-5 md:col-start-1",
            })}
          </GuideRow>
        </GuideCard>

        <GuideCard>
          <GuideRow label={fields.gameMode.label}>
            {renderFieldBox(fields.gameMode, { className: "md:col-span-6" })}
          </GuideRow>
        </GuideCard>

        <GuideCard className="space-y-2">
          {renderTeamRow(fields.team1, fields.coach1)}
          {renderTeamRow(fields.team2, fields.coach2)}
        </GuideCard>

        <GuideCard>
          <GuideRow label={fields.mapMode.label}>
            {renderFieldBox(fields.mapMode, { className: "md:col-span-6" })}
            {renderNote(fields.mapMode, "md:col-span-6")}
          </GuideRow>
        </GuideCard>

        <GuideCard>
          <GuideRow label={fields.server.label}>
            {renderFieldBox(fields.server, { className: "md:col-span-6" })}
            {renderNote(fields.server, "md:col-span-6")}
          </GuideRow>
        </GuideCard>

        <GuideCard>
          <GuideRow label={fields.observer.label}>
            {renderFieldBox(fields.observer, { className: "md:col-span-3" })}
          </GuideRow>
        </GuideCard>

        <GuideCard className="space-y-2">
          <GuideRow label={fields.gotv1.label}>
            {renderFieldBox(fields.gotv1, { className: "md:col-span-5" })}
          </GuideRow>
          <GuideRow label={fields.gotv2.label}>
            {renderFieldBox(fields.gotv2, { className: "md:col-span-5" })}
            {renderNote(fields.gotv2, "md:col-span-7")}
          </GuideRow>
          <GuideRow label={fields.gotvPassword.label}>
            {renderFieldBox(fields.gotvPassword, { className: "md:col-span-5" })}
          </GuideRow>
        </GuideCard>

        <GuideCard>
          <GuideRow label={fields.side.label}>
            {renderFieldBox(fields.side, { className: "md:col-span-6" })}
            {renderNote(fields.side, "md:col-span-6")}
          </GuideRow>
        </GuideCard>

        <GuideCard>
          <GuideRow label={fields.testMatch.label}>
            {renderFieldBox(fields.testMatch, { className: "md:col-span-3" })}
          </GuideRow>
        </GuideCard>
      </div>
    </section>
  );
}
