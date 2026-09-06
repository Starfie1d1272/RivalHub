"use client";

import React, { type ReactNode } from "react";
import { PaginationControls, useListQueryParams } from "@/components/rivalhub";
import { ADMIN_USERS_DEFAULTS } from "@/lib/admin/users-contract";
import { UserSearchBar, type UserFilter } from "./UserSearchBar";

interface AdminUsersListWorkspaceProps {
  children: ReactNode;
  filter: UserFilter;
  page: number;
  totalPages: number;
}

export function AdminUsersListWorkspace({
  children,
  filter,
  page,
  totalPages,
}: AdminUsersListWorkspaceProps) {
  const { searchParams, update } = useListQueryParams({
    routeBase: "/admin/users",
    defaults: ADMIN_USERS_DEFAULTS,
  });

  return (
    <>
      <UserSearchBar filter={filter} searchParams={searchParams} update={update} />
      {children}
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={(nextPage) => update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })}
      />
    </>
  );
}
