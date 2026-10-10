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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Map {guide.mapOrder} · {guide.mapName} · Perfect 建房指引</h3>
          <p className="mt-1 text-sm text-[var(--color-fg-mid)]">按后台表单顺序填写，使用本场已确定的地图和起始边；网站已完成 BP，无需在后台重复 BP。</p>
        </div>
        <Button asChild variant="outline" className="min-h-11"><a href="https://match.wmpvp.com/" target="_blank" rel="noopener noreferrer">打开 Perfect 后台 ↗</a></Button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {guide.fields.map(field => (
          <div key={field.label} className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <dt className="text-xs text-[var(--color-fg-mid)]">{field.label}</dt>
              <dd className="mt-1 break-words text-sm select-text">{field.value ?? "缺少赛事阶段或本轮对阵信息，请先检查赛程配置"}</dd>
            </div>
            {field.copyable && <Button size="sm" variant="outline" disabled={field.value === null} aria-label={`复制${field.label}`} onClick={() => field.value !== null && void copy(field.label, field.value)}>复制</Button>}
          </div>
        ))}
      </dl>
    </section>
  );
}
