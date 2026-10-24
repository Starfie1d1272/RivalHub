import { Suspense } from "react";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { EducationReviewOverview } from "@/components/admin/EducationReviewOverview";
import { EducationReviewWorkspace } from "@/components/admin/EducationReviewWorkspace";
import { ManualInstitutionCreateForm } from "@/components/admin/ManualInstitutionCreateForm";
import { type EducationReviewEmptyState } from "@/components/admin/EducationVerificationReviewQueue";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { ErrorState, PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getEducationReviewPage, getEducationReviewOverview, normalizeEducationReviewQuery } from "@/lib/education/admin-review";
import type { EducationReviewQuery } from "@/lib/education/admin-review-contract";
import { captureException } from "@/lib/observability/server";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function isDefaultPendingQuery(query: EducationReviewQuery): boolean {
  return !query.q
    && query.status === "pending"
    && !query.institution
    && query.academic === "all"
    && query.sort === "oldest";
}

export default async function EducationVerificationsAdminPage({ searchParams }: PageProps) {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;

  const query = normalizeEducationReviewQuery(await searchParams);
  return <PageLayout variant="standard" className="space-y-6">
    <PageHeader title="教育身份认证审核" description="仅在学信网官方页面人工核对；申请人声明学校不一致时请驳回，不要修改其学校。" />
    <ManualInstitutionCreateForm />
    <Suspense fallback={<Panel className="min-h-[260px]"><p role="status">正在读取教育认证概览…</p></Panel>}>
      <EducationOverviewRegion />
    </Suspense>
    <Suspense fallback={<Panel className="min-h-[400px]"><p role="status">正在读取审核队列…</p></Panel>}>
      <EducationQueueRegion query={query} />
    </Suspense>
  </PageLayout>;
}

async function EducationOverviewRegion() {
  try { return <EducationReviewOverview overview={await getEducationReviewOverview()} />; }
  catch (error) {
    captureException("education.review_overview.load_failed", error, { scope: "admin", operation: "education.review_overview.load", errorClass: "database", retryable: true });
    return <ErrorState code="EDUCATION_OVERVIEW_LOAD_FAILED" title="无法加载认证概览" sub="审核队列仍可独立读取，请稍后刷新概览。" />;
  }
}

async function EducationQueueRegion({ query }: { query: EducationReviewQuery }) {
  try {
    const queue = await getEducationReviewPage(query);
    const emptyState: EducationReviewEmptyState = !queue.hasAnyRecords ? "no-records"
      : isDefaultPendingQuery(queue.normalizedQuery) ? "no-pending" : "no-results";
    return <><EducationReviewWorkspace queue={queue} emptyState={emptyState} /><ContentReady module="admin" phase="primary" /></>;
  } catch (error) {
    captureException("education.review_queue.load_failed", error, { scope: "admin", operation: "education.review_queue.load", errorClass: "database", retryable: true });
    return <ErrorState code="EDUCATION_REVIEW_LOAD_FAILED" title="无法加载教育认证审核队列" sub="请稍后重试；如果问题持续，请联系系统管理员。" />;
  }
}
