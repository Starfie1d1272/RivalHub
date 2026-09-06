/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUsersListWorkspace } from "@/components/admin/AdminUsersListWorkspace";

const { pushMock, replaceMock, searchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsMock: { get: vi.fn(), toString: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/admin/users",
  useSearchParams: () => searchParamsMock,
}));

function renderUsersWorkspace(overrides: Partial<React.ComponentProps<typeof AdminUsersListWorkspace>> = {}) {
  return render(
    <AdminUsersListWorkspace filter="all" page={1} totalPages={1} {...overrides}>
      <div />
    </AdminUsersListWorkspace>,
  );
}

describe("AdminUsersListWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.get.mockImplementation((key: string) => key === "tab" ? "users" : null);
    searchParamsMock.toString.mockReturnValue("tab=users");
  });

  it("keeps the users tab and updates only the filter", () => {
    renderUsersWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "参赛过" }));

    expect(replaceMock).toHaveBeenCalledWith("/admin/users?tab=users&filter=participated");
  });

  it("shows a clear action for a non-default filter", () => {
    searchParamsMock.get.mockImplementation((key: string) => key === "tab" ? "users" : key === "filter" ? "none" : null);
    searchParamsMock.toString.mockReturnValue("tab=users&filter=none");
    renderUsersWorkspace({ filter: "none" });

    expect(screen.getByRole("button", { name: "清除筛选" })).toBeInTheDocument();
  });

  it("uses the same query owner for pagination and preserves the current filters", () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "tab") return "users";
      if (key === "q") return "player";
      if (key === "filter") return "participated";
      return null;
    });
    searchParamsMock.toString.mockReturnValue("tab=users&q=player&filter=participated");
    renderUsersWorkspace({ filter: "participated", totalPages: 3 });

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(pushMock).toHaveBeenCalledWith("/admin/users?tab=users&q=player&filter=participated&page=2");
  });
});
