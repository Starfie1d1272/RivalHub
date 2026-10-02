"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PerfectRoomGuideData } from "@/lib/admin/matches/operator-workflow";

export function PerfectRoomGuide({ guide }: { guide: PerfectRoomGuideData }) {
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); toast.success(`${label}已复制`); }
    catch { toast.error("复制失败，请选择字段内容手动复制。"); }
  }
  return (
    <section aria-label={`Map ${guide.mapOrder} Perfect 建房指引`} className="space-y-4 border-t border-[var(--color-border)] pt-4">
      <div>
        <h3 className="font-semibold">Map {guide.mapOrder} · {guide.mapName} · Perfect 建房指引</h3>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">Team 1 / Team 2 在整场比赛中保持不变。建房后返回 Mizar 检查 CS2、OBS 与直播。</p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {guide.copyFields.map(field => (
          <div key={field.label} className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <dt className="text-xs text-[var(--color-fg-mid)]">{field.label}</dt>
              <dd className="mt-1 break-words text-sm select-text">{field.value ?? "尚未确定，请核对本场轮次"}</dd>
            </div>
            <Button size="sm" variant="outline" disabled={field.value === null} aria-label={`复制${field.label}`} onClick={() => field.value !== null && void copy(field.label, field.value)}>复制</Button>
          </div>
        ))}
      </dl>
      <dl className="grid gap-x-6 gap-y-2 border-t border-[var(--color-border)] pt-3 text-sm sm:grid-cols-2">
        {guide.instructions.map(field => <div key={field.label} className="min-w-0"><dt className="text-[var(--color-fg-mid)]">{field.label}</dt><dd className="break-words">{field.value}</dd></div>)}
      </dl>
    </section>
  );
}
