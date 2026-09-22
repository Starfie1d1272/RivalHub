"use client";

import React, { type ReactNode } from "react";
import { PaginationControls, useListQueryParams } from "@/components/rivalhub";
import {
  ADMIN_USERS_DEFAULTS,
  type AdminUserActivityFilter,
  type AdminUserEducationFilter,
  type AdminUserTeamFilter,
  type AdminUserParticipationFilter,
} from "@/lib/admin/users-contract";
import { UserSearchBar } from "./UserSearchBar";

interface AdminUsersListWorkspaceProps {
  children: ReactNode;
  filter: AdminUserParticipationFilter;
  education: AdminUserEducationFilter;
  team: AdminUserTeamFilter;
  activity: AdminUserActivityFilter;
  page: number;
  totalPages: number;
}

export function AdminUsersListWorkspace({
  children,
  filter,
  education,
  team,
  activity,
  page,
  totalPages,
}: AdminUsersListWorkspaceProps) {
  const { searchParams, update } = useListQueryParams({
    routeBase: "/admin/users",
    defaults: ADMIN_USERS_DEFAULTS,
  });

  return (
    <>
      <UserSearchBar filter={filter} education={education} team={team} activity={activity} searchParams={searchParams} update={update} />
      {children}
      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPageChange={(nextPage) => update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })}
      />
    </>
  );
}
