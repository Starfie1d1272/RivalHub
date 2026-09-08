"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { EducationReviewControls } from "@/components/admin/EducationReviewControls";
import { EducationVerificationReviewQueue, type EducationReviewEmptyState } from "@/components/admin/EducationVerificationReviewQueue";
import { MiniStat, PaginationControls, Panel, useListQueryParams } from "@/components/rivalhub";
import {
  EDUCATION_REVIEW_DEFAULTS,
  type EducationReviewQueue,
} from "@/lib/education/admin-review-contract";

const ROUTE_BASE = "/admin/education-verifications";

interface EducationReviewWorkspaceProps {
  queue: EducationReviewQueue;
  emptyState: EducationReviewEmptyState;
}

export function EducationReviewWorkspace({ queue, emptyState }: EducationReviewWorkspaceProps) {
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({ routeBase: ROUTE_BASE, defaults: EDUCATION_REVIEW_DEFAULTS });
  const overview = queue.overview;
  const coverage = overview.activeUserCount > 0
    ? `${Math.round((overview.approvedUserCount / overview.activeUserCount) * 100)}%`
    : "0%";

  return (
    <>
      <Panel label="教育认证概览" contentClassName="p-5">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="已认证用户" value={overview.approvedUserCount} accent />
            <MiniStat label="平台注册用户" value={overview.activeUserCount} />
            <MiniStat label="认证覆盖率" value={coverage} />
          </div>
          <p className="text-xs leading-5 text-[var(--color-fg-mid)]">覆盖率按已认证用户 / 当前有效平台注册用户计算。以下为认证教育身份分布；同一用户可拥有多个学校身份，合计不必等于已认证用户数。</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold">学校分布</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {overview.institutionDistribution.length > 0
                  ? overview.institutionDistribution.map((item) => <span key={item.id} className="rounded-sm border border-[var(--color-border)] px-2 py-1 text-xs">{item.name} · {item.identityCount}</span>)
                  : <span className="text-xs text-[var(--color-fg-mid)]">暂无已认证教育身份</span>}
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold">身份分布</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-sm border border-[var(--color-border)] px-2 py-1">在读 · {overview.academicDistribution.enrolled}</span>
                <span className="rounded-sm border border-[var(--color-border)] px-2 py-1">已毕业 · {overview.academicDistribution.graduated}</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>
      <EducationReviewControls
        total={queue.total}
        page={queue.page}
        pageSize={queue.pageSize}
        totalPages={queue.totalPages}
        institutionOptions={queue.institutionOptions}
        normalizedQuery={queue.normalizedQuery}
        searchParams={searchParams}
        update={update}
      />
      <EducationVerificationReviewQueue rows={queue.rows} emptyState={emptyState} />
      <PaginationControls
        page={queue.page}
        totalPages={queue.totalPages}
        onPageChange={(page) => update({ page }, { defaults: { page: 1 }, history: "push" })}
      />
    </>
  );
}
