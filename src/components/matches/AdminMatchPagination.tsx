"use client";
import { PaginationControls, ResultSummary, useListQueryParams } from "@/components/rivalhub";

export function AdminMatchPagination({ total, page, pageSize, totalPages }: {
  total: number; page: number; pageSize: number; totalPages: number;
}) {
  const { update } = useListQueryParams();
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <ResultSummary total={total} page={page} pageSize={pageSize} />
    <PaginationControls page={page} totalPages={totalPages} onPageChange={page => update({ page }, { history: "push", defaults: { page: 1 } })} />
  </div>;
}
