import React from "react";
import Link from "next/link";

export interface AdminExceptionSummaryData {
  pendingApplications: number;
  unresolvedPrestartIssues: number;
  unconfirmedEntrants: number;
  scheduledMatchesWithoutConfirmedLineups: number;
  finalResultPendingConfirmation: boolean;
  activeAdjudications: number;
}

export function AdminExceptionSummary({ seasonSlug, data }: { seasonSlug: string; data: AdminExceptionSummaryData }) {
  const items = [
    { label: "待审核组队报名", value: data.pendingApplications, href: `/admin/${seasonSlug}/registrations` },
    { label: "赛前待解决事项", value: data.unresolvedPrestartIssues, href: `/admin/${seasonSlug}` },
    { label: "未确认参赛名单", value: data.unconfirmedEntrants, href: `/admin/${seasonSlug}` },
    { label: "已排期但名单未确认", value: data.scheduledMatchesWithoutConfirmedLineups, href: `/admin/${seasonSlug}/matches` },
    { label: "最终结果待确认", value: data.finalResultPendingConfirmation ? 1 : 0, href: `/admin/${seasonSlug}` },
    { label: "生效中的赛后裁定", value: data.activeAdjudications, href: `/admin/${seasonSlug}` },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="待处理与异常">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">待处理 / 异常</h2>
        <span className="text-xs text-muted-foreground">仅显示可由当前赛事事实确定的事项</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <Link key={item.label} href={item.href as never} className="rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted">
            <span className="block text-lg font-semibold tabular-nums">{item.value}</span>
            <span className="block text-xs text-muted-foreground">{item.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
