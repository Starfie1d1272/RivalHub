import React from "react";
import { Marker, Panel, StatusPill } from "@/components/rivalhub";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import type { PostEventPageData } from "@/lib/admin/season-workspace/types";

export function SeasonPostEventOverview({ data }: { data: PostEventPageData }) {
  const status = presentSeasonStatus(data.season.status);
  const summary = {
    matchCount: data.data.matchCount,
    honorCount: data.data.honorCount,
    activeAdjudicationCount: data.data.activeAdjudicationCount,
  };

  return <div className="space-y-5">
    <Marker sub={`通用赛后收尾 · ${data.season.name}`} action={<StatusPill {...status} />}>赛后工作区</Marker>
    <Panel label="赛后摘要">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border border-[var(--color-border)] px-3 py-3"><p className="text-xs text-[var(--color-fg-mid)]">比赛</p><p className="mt-1 text-2xl font-semibold tabular-nums">{summary.matchCount}</p></div>
        <div className="border border-[var(--color-border)] px-3 py-3"><p className="text-xs text-[var(--color-fg-mid)]">已记录荣誉</p><p className="mt-1 text-2xl font-semibold tabular-nums">{summary.honorCount}</p></div>
        <div className="border border-[var(--color-border)] px-3 py-3"><p className="text-xs text-[var(--color-fg-mid)]">生效中的裁决</p><p className="mt-1 text-2xl font-semibold tabular-nums">{summary.activeAdjudicationCount}</p></div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--color-fg-mid)]">当前赛事模板仅提供通用赛后摘要；专门的赛事收尾能力由对应赛事工作区提供。</p>
    </Panel>
  </div>;
}
