import { EducationReviewWorkspace } from "@/components/admin/EducationReviewWorkspace";
import { type EducationReviewEmptyState } from "@/components/admin/EducationVerificationReviewQueue";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { ErrorState, PageHeader, PageLayout } from "@/components/rivalhub";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getEducationReviewQueue, normalizeEducationReviewQuery } from "@/lib/education/admin-review";
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

  let queue;
  try {
    const normalizedQuery = normalizeEducationReviewQuery(await searchParams);
    queue = await getEducationReviewQueue(normalizedQuery);
  } catch (error) {
    captureException("education.review_queue.load_failed", error, {
      scope: "admin",
      operation: "education.review_queue.load",
      errorClass: "database",
      retryable: true,
    });
    return (
      <PageLayout variant="standard" className="space-y-6">
        <PageHeader
          title="教育身份认证审核"
          description="仅在学信网官方页面人工核对；申请人声明学校不一致时请驳回，不要修改其学校。"
        />
        <ErrorState code="EDUCATION_REVIEW_LOAD_FAILED" title="无法加载教育认证审核队列" sub="请稍后重试；如果问题持续，请联系系统管理员。" />
      </PageLayout>
    );
  }

  const emptyState: EducationReviewEmptyState = !queue.hasAnyRecords
    ? "no-records"
    : isDefaultPendingQuery(queue.normalizedQuery)
      ? "no-pending"
      : "no-results";

  return (
    <PageLayout variant="standard" className="space-y-6">
      <PageHeader
        title="教育身份认证审核"
        description="仅在学信网官方页面人工核对；申请人声明学校不一致时请驳回，不要修改其学校。"
      />
      <EducationReviewWorkspace queue={queue} emptyState={emptyState} />
    </PageLayout>
  );
}
