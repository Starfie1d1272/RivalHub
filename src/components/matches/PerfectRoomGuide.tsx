"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PerfectRoomGuideData } from "@/lib/admin/matches/operator-workflow";

export function PerfectRoomGuide({ guide }: { guide: PerfectRoomGuideData }) {
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); toast.success(`${label}已复制`); }
    catch { toast.error("复制失败，请手动复制。"); }
  }
  const fields = (items: PerfectRoomGuideData["fields"]) => <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
    {items.map(field => <div key={field.label} className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--color-border)] pb-2">
      <div className="min-w-0">
        <dt className="text-xs text-[var(--color-fg-mid)]">{field.label}</dt>
        <dd className="mt-1 break-words text-sm select-text">{field.value ?? "待核对赛程配置"}</dd>
      </div>
      {field.copyable && <Button size="sm" variant="ghost" disabled={field.value === null} aria-label={`复制${field.label}`} onClick={() => field.value !== null && void copy(field.label, field.value)}>复制</Button>}
    </div>)}
  </dl>;
  return (
    <section aria-label={`Map ${guide.mapOrder} Perfect 建房指引`} className="space-y-3 border-t border-[var(--color-border)] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Perfect 建房</h3>
        <Button asChild size="sm"><a href="https://match.wmpvp.com/" target="_blank" rel="noopener noreferrer">打开后台 ↗</a></Button>
      </div>
      {fields(guide.fields.filter(field => field.copyable || field.label === "选边方式" || field.label === "选图模式" || field.label === "比赛归属"))}
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm text-[var(--color-fg-mid)]">固定设置 · 无需重复 BP</summary>
        {fields(guide.fields.filter(field => !field.copyable && field.label !== "选边方式" && field.label !== "选图模式" && field.label !== "比赛归属"))}
      </details>
    </section>
  );
}
