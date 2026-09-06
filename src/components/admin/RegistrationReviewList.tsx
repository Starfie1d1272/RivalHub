"use client";

import React, { useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { reviewRegistration } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { positionLabel } from "@/lib/validators/registration";
import { getDisplayName } from "@/lib/identity/display-name";
import { REGISTRATION_STATUS_LABELS } from "@/types/registration";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import {
  ClearFilters,
  ListSearchField,
  ListToolbar,
  PaginationControls,
  ResultSummary,
  type ListSearchFieldHandle,
  useListQueryParams,
} from "@/components/rivalhub";
import {
  SOLO_REGISTRATION_REVIEW_DEFAULTS,
  type RegistrationRow,
  type SoloRegistrationReviewQuery,
} from "@/lib/registrations/admin-review-contract";

export type { RegistrationRow } from "@/lib/registrations/admin-review-contract";

const STATUS_OPTIONS = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "waitlisted", label: "候补名单" },
  { value: "all", label: "全部状态" },
] as const;

const SORT_OPTIONS = [
  { value: "oldest", label: "最早报名" },
  { value: "newest", label: "最近提交" },
] as const;

const SELECT_CLASS_NAME = "min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-[var(--color-warn-soft)] text-[var(--color-warn)] border-[var(--color-warn-edge)]",
  approved: "bg-[var(--color-ok-soft)] text-[var(--color-ok)] border-[var(--color-ok-edge)]",
  rejected: "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger-edge)]",
  waitlisted: "bg-[var(--color-info-soft)] text-[var(--color-info)] border-[var(--color-info-edge)]",
};

interface Props {
  seasonSlug: string;
  positions: readonly string[];
  registrations: RegistrationRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  normalizedQuery: SoloRegistrationReviewQuery;
  hasAnyRecords: boolean;
}

export function RegistrationReviewList({
  seasonSlug,
  positions,
  registrations,
  total,
  page,
  pageSize,
  totalPages,
  normalizedQuery,
  hasAnyRecords,
}: Props) {
  const availablePositions = positions;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({
    routeBase: `/admin/${seasonSlug}/registrations`,
    defaults: SOLO_REGISTRATION_REVIEW_DEFAULTS,
  });
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  const [isPending, startTransition] = useTransition();

  const requestedStatus = searchParams.get("status");
  const currentStatus = STATUS_OPTIONS.some((option) => option.value === requestedStatus)
    ? requestedStatus as SoloRegistrationReviewQuery["status"]
    : normalizedQuery.status;
  const requestedPosition = searchParams.get("position") ?? "";
  const currentPosition = availablePositions.includes(requestedPosition) ? requestedPosition : normalizedQuery.position ?? "";
  const requestedSort = searchParams.get("sort");
  const currentSort = SORT_OPTIONS.some((option) => option.value === requestedSort)
    ? requestedSort as SoloRegistrationReviewQuery["sort"]
    : normalizedQuery.sort;

  function handleReview(registrationId: string, status: "pending" | "approved" | "rejected" | "waitlisted") {
    const label = REGISTRATION_STATUS_LABELS[status];
    startTransition(async () => {
      const result = await reviewRegistration({ registrationId, status });
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`已${label}`);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <ListToolbar className="mb-4 items-start" aria-label="报名搜索与筛选">
        <ListSearchField
          ref={searchFieldRef}
          queryKey="q"
          label="搜索报名"
          placeholder="姓名 / 邮箱 / Perfect 名称…"
          value={searchParams.get("q") ?? ""}
          onDebouncedChange={(value) => update({ q: value })}
          className="min-w-0 w-full flex-1 basis-full lg:basis-[34%]"
        />
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[22%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span>
          <select
            aria-label="报名状态"
            value={currentStatus}
            onChange={(event) => update({ status: event.target.value })}
            className={SELECT_CLASS_NAME}
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[22%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">位置</span>
          <select
            aria-label="报名位置"
            value={currentPosition}
            onChange={(event) => update({ position: event.target.value })}
            className={SELECT_CLASS_NAME}
          >
            <option value="">全部位置</option>
            {availablePositions.map((position) => <option key={position} value={position}>{positionLabel(position)}</option>)}
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[16%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">排序</span>
          <select
            aria-label="报名排序"
            value={currentSort}
            onChange={(event) => update({ sort: event.target.value })}
            className={SELECT_CLASS_NAME}
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <ClearFilters
          defaults={SOLO_REGISTRATION_REVIEW_DEFAULTS}
          searchParams={searchParams}
          onClear={(updates) => {
            searchFieldRef.current?.reset();
            update(updates);
          }}
        />
      </ListToolbar>

      <Separator className="mb-4" />

      {registrations.length === 0 ? (
        <p className="py-8 text-center text-[var(--color-fg-mid)]">
          {hasAnyRecords ? "没有符合当前筛选条件的报名" : "暂无报名记录"}
        </p>
      ) : (
        <div className="space-y-3">
          {registrations.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{getDisplayName(r)}</span>
                    <Badge variant="outline" className={STATUS_STYLES[r.status]}>
                      {REGISTRATION_STATUS_LABELS[r.status as keyof typeof REGISTRATION_STATUS_LABELS]}
                    </Badge>
                    {r.willingToBeCaptain && <Badge variant="secondary" className="text-xs">队长意向</Badge>}
                  </div>

                  <div className="space-y-0.5 text-sm text-[var(--color-fg-mid)]">
                    <p>位置：{positionLabel(r.primaryPosition)}（主）| {positionLabel(r.secondaryPosition)}（次）</p>
                    <p>最高段位：{r.peakRank}（{r.peakRankSeason}）Rating {r.peakRating}{" | "}当前赛季：{r.currentSeasonPeakRank} Rating {r.currentRating}</p>
                    <p>{r.email}{r.qq && ` | QQ: ${r.qq}`}{r.studentId && ` | 学号: ${r.studentId}`}</p>
                    {r.steam64 && <p>Steam64: {r.steam64}{r.steamProfileUrl && <>{" | "}<a href={r.steamProfileUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--color-fg)]">Steam 主页</a></>}</p>}
                    {r.gameplayStyle && <p>风格：{r.gameplayStyle}</p>}
                    {r.competitionHistory && <p>比赛经历：{r.competitionHistory}</p>}
                    {r.notes && <p>备注：{r.notes}</p>}
                  </div>

                  <div className="mt-2"><MapPreferenceChips preferences={r.mapPreferences} minLevel="playable" /></div>
                  {r.screenshotUrls.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{r.screenshotUrls.map((url, index) => <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-fg-mid)] underline hover:text-[var(--color-fg)]">截图 {index + 1}</a>)}</div>}
                </div>

                <div className="flex shrink-0 flex-col gap-1.5">
                  {r.status === "pending" && <>
                    <Button size="sm" variant="default" disabled={isPending} onClick={() => handleReview(r.id, "approved")}>通过</Button>
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleReview(r.id, "waitlisted")}>候补</Button>
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleReview(r.id, "rejected")}>拒绝</Button>
                  </>}
                  {r.status === "waitlisted" && <>
                    <Button size="sm" variant="default" disabled={isPending} onClick={() => handleReview(r.id, "approved")}>通过</Button>
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleReview(r.id, "rejected")}>拒绝</Button>
                  </>}
                  {r.status === "approved" && <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleReview(r.id, "pending")}>撤回待审</Button>}
                  {r.status === "rejected" && <>
                    <Button size="sm" variant="default" disabled={isPending} onClick={() => handleReview(r.id, "approved")}>改为通过</Button>
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleReview(r.id, "pending")}>回到待审</Button>
                  </>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-between gap-3">
        <ResultSummary total={total} page={page} pageSize={pageSize} totalPages={totalPages} />
      </div>
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={(nextPage) => update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })}
        className="mt-4"
      />
    </div>
  );
}
