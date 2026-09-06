"use client";

import { useSearchParams } from "next/navigation";
import { EducationReviewControls } from "@/components/admin/EducationReviewControls";
import { EducationVerificationReviewQueue, type EducationReviewEmptyState } from "@/components/admin/EducationVerificationReviewQueue";
import { PaginationControls, useListQueryParams } from "@/components/rivalhub";
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

  return (
    <>
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
