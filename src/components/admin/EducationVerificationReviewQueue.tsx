"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { reviewEducationVerification } from "@/actions/education-verifications";
import {
  ClearFilters,
  EmptyState,
  ListSearchField,
  ListToolbar,
  PaginationControls,
  Panel,
  ResultSummary,
  useListQueryParams,
} from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { formatCST } from "@/lib/utils/date";
import {
  EDUCATION_REVIEW_DEFAULTS,
  type EducationReviewAcademic,
  type EducationReviewQuery,
  type EducationReviewRow,
  type EducationReviewSort,
  type EducationReviewStatus,
} from "@/lib/education/admin-review-contract";

const STATUS_OPTIONS: { value: EducationReviewStatus; label: string }[] = [
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

interface Props {
  rows: EducationReviewRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  institutionOptions?: { id: string; name: string }[];
  normalizedQuery?: EducationReviewQuery;
  hasAnyRecords?: boolean;
}

function isChsiEvidenceType(evidenceType: string): boolean {
  return evidenceType === "chsi_enrollment_report" || evidenceType === "chsi_education_report";
}

function selectValue<T extends string>(value: string | null, options: readonly { value: T; label: string }[], fallback: T): T {
  return options.some((option) => option.value === value) ? value as T : fallback;
}

const selectClassName = "min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

export function EducationVerificationReviewQueue({
  rows,
  total = rows.length,
  page = 1,
  pageSize = 25,
  totalPages = Math.ceil(total / pageSize),
  institutionOptions = [],
  normalizedQuery = {
    q: undefined,
    status: EDUCATION_REVIEW_DEFAULTS.status,
    institution: undefined,
    academic: EDUCATION_REVIEW_DEFAULTS.academic,
    sort: EDUCATION_REVIEW_DEFAULTS.sort,
    page: 1,
    pageSize: 25,
  },
  hasAnyRecords = rows.length > 0,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({ routeBase: "/admin/education-verifications", defaults: EDUCATION_REVIEW_DEFAULTS });
  const [pending, startTransition] = useTransition();

  const currentStatus = selectValue(searchParams.get("status"), STATUS_OPTIONS, normalizedQuery.status);
  const currentAcademic = selectValue(searchParams.get("academic"), ACADEMIC_OPTIONS, normalizedQuery.academic);
  const currentSort = selectValue(searchParams.get("sort"), SORT_OPTIONS, normalizedQuery.sort);
  const requestedInstitution = searchParams.get("institution") ?? normalizedQuery.institution ?? "";
  const currentInstitution = institutionOptions.some((institution) => institution.id === requestedInstitution) ? requestedInstitution : "";

  const review = (id: string, decision: "approved" | "rejected") => {
    const reviewNote = decision === "rejected"
      ? window.prompt("请输入驳回原因（将显示给申请人）") ?? ""
      : window.prompt("审核备注（可选，仅管理员可见）") ?? "";
    if (decision === "rejected" && !reviewNote.trim()) return;
    startTransition(async () => {
      const result = await reviewEducationVerification({ id, decision, reviewNote });
      if (result.success) {
        toast.success(decision === "approved" ? "认证已通过" : "认证已驳回");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  };

  const copyEvidenceCode = (evidenceCode: string) => startTransition(async () => {
    try {
      await navigator.clipboard.writeText(evidenceCode);
      toast.success("在线验证码已复制");
    } catch {
      toast.error("无法复制验证码，请手动复制");
    }
  });

  return (
    <div className="min-w-0 space-y-4">
      <ListToolbar className="items-start">
        <ListSearchField
          queryKey="q"
          label="搜索认证记录"
          placeholder="姓名 / 邮箱 / 学校 / 在线验证码…"
          defaults={EDUCATION_REVIEW_DEFAULTS}
          routeBase="/admin/education-verifications"
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
        <ClearFilters defaults={EDUCATION_REVIEW_DEFAULTS} routeBase="/admin/education-verifications" />
      </ListToolbar>

      <div className="flex items-center justify-between gap-3">
        <ResultSummary total={total} page={page} pageSize={pageSize} totalPages={totalPages} />
        {pending && <span className="text-xs text-[var(--color-accent)]">处理中…</span>}
      </div>

      {rows.length === 0 ? (
        <Panel contentClassName="p-0">
          <EmptyState
            title={hasAnyRecords ? "当前筛选没有匹配结果" : "当前没有教育认证记录"}
            sub={hasAnyRecords ? "可以调整搜索条件或清除筛选。" : "新的教育认证提交后会出现在这里。"}
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Panel key={row.id} contentClassName="p-5">
              <div className="space-y-2">
                <p className="font-semibold">
                  {row.displayName || row.email} · {row.status === "pending" ? "待审核" : row.status === "approved" ? "已通过" : "已驳回"}
                </p>
                <p className="text-sm text-[var(--color-fg-mid)]">账号：{row.email}</p>
                <p className="text-sm">声明学校：{row.institution}{row.code ? `（${row.code}）` : ""} · {row.academicStatus === "enrolled" ? "在读" : "已毕业"}</p>
                <p className="text-sm">提交时间：{formatCST(row.submittedAt)}</p>
                <p className="text-sm">证据类型：{row.evidenceType}</p>
                {row.evidenceCode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm">在线验证码：<span className="font-mono">{row.evidenceCode}</span></p>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => copyEvidenceCode(row.evidenceCode!)}>复制验证码</Button>
                    <a className="text-sm underline" href="https://www.chsi.com.cn/xlcx/bgcx.jsp" target="_blank" rel="noopener noreferrer">在学信网核验 ↗</a>
                  </div>
                ) : row.status !== "pending" && isChsiEvidenceType(row.evidenceType) ? (
                  <p className="text-sm text-[var(--color-fg-mid)]">在线验证码：已按保留策略清理</p>
                ) : null}
                {row.reviewNote && <p className="text-sm text-[var(--color-fg-mid)]">审核备注：{row.reviewNote}</p>}
                {row.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button disabled={pending} onClick={() => review(row.id, "approved")}>通过</Button>
                    <Button disabled={pending} variant="outline" onClick={() => review(row.id, "rejected")}>驳回</Button>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <PaginationControls page={page} totalPages={totalPages} routeBase="/admin/education-verifications" />
    </div>
  );
}
