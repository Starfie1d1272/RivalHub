"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type {
  PerfectRoomFieldKey,
  PerfectRoomGuideData,
  PerfectRoomGuideField,
} from "@/lib/admin/matches/operator-workflow";

const CARD_CLASS =
  "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-panel)] px-3.5 py-2.5";

const ROW_GRID_CLASS =
  "grid grid-cols-1 gap-2 md:grid-cols-[9.5rem_minmax(0,1fr)] md:items-center md:gap-x-3";

const LABEL_CLASS = "text-xs font-medium text-[var(--color-fg-essential)] md:text-right";

export function PerfectRoomGuide({ guide }: { guide: PerfectRoomGuideData }) {
  const byKey = new Map<PerfectRoomFieldKey, PerfectRoomGuideField>(
    guide.fields.map((field) => [field.key, field]),
  );

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制`);
    } catch {
      toast.error("复制失败，请手动复制。");
    }
  }

  function fieldBox(
    field: PerfectRoomGuideField | undefined,
    options?: {
      inlineLabel?: string;
      badge?: string;
      warn?: boolean;
      className?: string;
    },
  ) {
    if (!field) return null;
    const isMissing = field.value === null;
    const isDefault = !field.actionRequired && !field.copyable;
    const warnTone = Boolean(options?.warn) || isMissing;

    return (
      <div
        className={cn(
          "flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 py-1.5",
          warnTone
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
            {options?.badge && (
              <span
                className={cn(
                  "shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium leading-none",
                  warnTone
                    ? "border border-[var(--color-warn-edge)] text-[var(--color-warn)]"
                    : "border border-[var(--color-border)] text-[var(--color-fg-mid)]",
                )}
              >
                {options.badge}
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

  const season = byKey.get("season");
  const round = byKey.get("round");
  const description = byKey.get("description");
  const gameMode = byKey.get("gameMode");
  const team1 = byKey.get("team1");
  const coach1 = byKey.get("coach1");
  const team2 = byKey.get("team2");
  const coach2 = byKey.get("coach2");
  const mapMode = byKey.get("mapMode");
  const server = byKey.get("server");
  const observer = byKey.get("observer");
  const gotv1 = byKey.get("gotv1");
  const gotv2 = byKey.get("gotv2");
  const gotvPassword = byKey.get("gotvPassword");
  const side = byKey.get("side");
  const testMatch = byKey.get("testMatch");

  return (
    <section
      aria-label={`Map ${guide.mapOrder} Perfect 建房指引`}
      className="space-y-2.5 border-t border-[var(--color-border)] pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-medium">
            Perfect 建房 · Map {guide.mapOrder} · {guide.mapName}
          </h3>
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
        {/* Card 1: 比赛归属 + 轮次 / 比赛短描述 */}
        <div className={CARD_CLASS}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[9.5rem_minmax(0,1fr)] md:items-start md:gap-x-3">
            <div className={cn(LABEL_CLASS, "md:pt-2.5")}>比赛归属：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12">
              {fieldBox(season, {
                inlineLabel: "选择本届赛事",
                className: "md:col-span-6",
              })}
              {fieldBox(round, {
                inlineLabel: "轮次",
                className: "md:col-span-5",
              })}
              {fieldBox(description, {
                inlineLabel: "比赛短描述",
                className: "md:col-span-5 md:col-start-1",
              })}
            </div>
          </div>
        </div>

        {/* Card 2: 游戏模式 */}
        <div className={CARD_CLASS}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>游戏模式：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(gameMode, {
                badge: gameMode?.note,
                className: "md:col-span-6",
              })}
            </div>
          </div>
        </div>

        {/* Card 3: 设置队伍1 / 设置队伍2 与各自教练64位ID */}
        <div className={cn(CARD_CLASS, "space-y-2")}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>设置队伍 1：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-12 lg:items-center">
              {fieldBox(team1, { className: "lg:col-span-5" })}
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5 lg:col-span-7">
                <span className="shrink-0 text-xs font-medium text-[var(--color-fg-mid)]">
                  教练 64 位 ID：
                </span>
                {fieldBox(coach1, { className: "w-full sm:max-w-[15rem]" })}
              </div>
            </div>
          </div>

          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>设置队伍 2：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-12 lg:items-center">
              {fieldBox(team2, { className: "lg:col-span-5" })}
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5 lg:col-span-7">
                <span className="shrink-0 text-xs font-medium text-[var(--color-fg-mid)]">
                  教练 64 位 ID：
                </span>
                {fieldBox(coach2, { className: "w-full sm:max-w-[15rem]" })}
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: 选图模式 */}
        <div className={CARD_CLASS}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>选图模式：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(mapMode, { className: "md:col-span-6" })}
              {mapMode?.note && (
                <p className="text-xs text-[var(--color-fg-mid)] md:col-span-6">{mapMode.note}</p>
              )}
            </div>
          </div>
        </div>

        {/* Card 5: 服务器选择 */}
        <div className={CARD_CLASS}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>服务器选择：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(server, {
                badge: "须手动改选",
                warn: true,
                className: "md:col-span-6",
              })}
              {server?.note && (
                <p className="text-xs text-[var(--color-warn)] md:col-span-6">{server.note}</p>
              )}
            </div>
          </div>
        </div>

        {/* Card 6: 观察者选项（窄控件比例） */}
        <div className={CARD_CLASS}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>观察者选项：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(observer, {
                badge: observer?.note,
                className: "md:col-span-3",
              })}
            </div>
          </div>
        </div>

        {/* Card 7: GOTV 三行竖排 */}
        <div className={cn(CARD_CLASS, "space-y-2")}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>GOTV 线路 1 延迟：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(gotv1, { className: "md:col-span-5" })}
            </div>
          </div>

          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>GOTV 线路 2 延迟：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(gotv2, { className: "md:col-span-5" })}
              {gotv2?.note && (
                <p className="text-xs text-[var(--color-fg-mid)] md:col-span-7">{gotv2.note}</p>
              )}
            </div>
          </div>

          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>GOTV Password：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(gotvPassword, { className: "md:col-span-5" })}
            </div>
          </div>
        </div>

        {/* Card 8: 选边方式 */}
        <div className={CARD_CLASS}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>选边方式：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(side, {
                badge: "须核对",
                warn: true,
                className: "md:col-span-6",
              })}
              {side?.note && (
                <p className="text-xs text-[var(--color-warn)] md:col-span-6">{side.note}</p>
              )}
            </div>
          </div>
        </div>

        {/* Card 9: 测试赛 */}
        <div className={CARD_CLASS}>
          <div className={ROW_GRID_CLASS}>
            <div className={LABEL_CLASS}>测试赛：</div>
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              {fieldBox(testMatch, { className: "md:col-span-3" })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
