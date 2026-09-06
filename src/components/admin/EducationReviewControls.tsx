"use client";

import { useSearchParams } from "next/navigation";
import {
  ClearFilters,
  ListSearchField,
  ListToolbar,
  ResultSummary,
  useListQueryParams,
} from "@/components/rivalhub";
import {
  EDUCATION_REVIEW_DEFAULTS,
  type EducationReviewAcademic,
  type EducationReviewFilterStatus,
  type EducationReviewQuery,
  type EducationReviewSort,
} from "@/lib/education/admin-review-contract";

const ROUTE_BASE = "/admin/education-verifications";

const STATUS_OPTIONS: { value: EducationReviewFilterStatus; label: string }[] = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "all", label: "全部状态" },
];

const ACADEMIC_OPTIONS: { value: EducationReviewAcademic; label: string }[] = [
  { value: "all", label: "全部身份" },
  { value: "enrolled", label: "在读" },
  { value: "graduated", label: "已毕业" },
];

const SORT_OPTIONS: { value: EducationReviewSort; label: string }[] = [
  { value: "oldest", label: "最早提交" },
  { value: "newest", label: "最近提交" },
  { value: "recently_reviewed", label: "最近审核" },
];

const selectClassName = "min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

interface EducationReviewControlsProps {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  institutionOptions: { id: string; name: string }[];
  normalizedQuery: EducationReviewQuery;
}

function selectValue<T extends string>(value: string | null, options: readonly { value: T; label: string }[], fallback: T): T {
  return options.some((option) => option.value === value) ? value as T : fallback;
}

export function EducationReviewControls({
  total,
  page,
  pageSize,
  totalPages,
  institutionOptions,
  normalizedQuery,
}: EducationReviewControlsProps) {
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({ routeBase: ROUTE_BASE, defaults: EDUCATION_REVIEW_DEFAULTS });
  const currentStatus = selectValue(searchParams.get("status"), STATUS_OPTIONS, normalizedQuery.status);
  const currentAcademic = selectValue(searchParams.get("academic"), ACADEMIC_OPTIONS, normalizedQuery.academic);
  const currentSort = selectValue(searchParams.get("sort"), SORT_OPTIONS, normalizedQuery.sort);
  const requestedInstitution = searchParams.get("institution") ?? normalizedQuery.institution ?? "";
  const currentInstitution = institutionOptions.some((institution) => institution.id === requestedInstitution) ? requestedInstitution : "";

  return (
    <div className="min-w-0 space-y-4">
      <ListToolbar className="items-start">
        <ListSearchField
          queryKey="q"
          label="搜索认证记录"
          placeholder="姓名 / 邮箱 / 学校 / 在线验证码…"
          value={searchParams.get("q") ?? ""}
          onDebouncedChange={(value) => update({ q: value }, { defaults: EDUCATION_REVIEW_DEFAULTS })}
          className="min-w-0 w-full flex-1 basis-full lg:basis-[30%]"
        />
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[15%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span>
          <select
            aria-label="认证状态"
            value={currentStatus}
            onChange={(event) => update({ status: event.target.value }, { defaults: EDUCATION_REVIEW_DEFAULTS })}
            className={selectClassName}
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[25%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">学校</span>
          <select
            aria-label="认证学校"
            value={currentInstitution}
            onChange={(event) => update({ institution: event.target.value }, { defaults: EDUCATION_REVIEW_DEFAULTS })}
            className={selectClassName}
          >
            <option value="">全部学校</option>
            {institutionOptions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[15%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">身份</span>
          <select
            aria-label="学籍状态"
            value={currentAcademic}
            onChange={(event) => update({ academic: event.target.value }, { defaults: EDUCATION_REVIEW_DEFAULTS })}
            className={selectClassName}
          >
            {ACADEMIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[15%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">排序</span>
          <select
            aria-label="审核排序"
            value={currentSort}
            onChange={(event) => update({ sort: event.target.value }, { defaults: EDUCATION_REVIEW_DEFAULTS })}
            className={selectClassName}
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <ClearFilters defaults={EDUCATION_REVIEW_DEFAULTS} routeBase={ROUTE_BASE} />
      </ListToolbar>

      <div className="flex items-center justify-between gap-3">
        <ResultSummary total={total} page={page} pageSize={pageSize} totalPages={totalPages} />
      </div>

    </div>
  );
}
