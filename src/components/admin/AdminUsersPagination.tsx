"use client";

import { PaginationControls, useListQueryParams } from "@/components/rivalhub";
import { ADMIN_USERS_DEFAULTS } from "@/lib/admin/users-contract";

export function AdminUsersPagination({ page, totalPages }: { page: number; totalPages: number }) {
  const { update } = useListQueryParams({ routeBase: "/admin/users", defaults: ADMIN_USERS_DEFAULTS });
  return (
    <PaginationControls
      page={page}
      totalPages={totalPages}
      onPageChange={(nextPage) => update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })}
    />
  );
}
