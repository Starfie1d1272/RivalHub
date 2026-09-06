/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserSearchBar } from "@/components/admin/UserSearchBar";

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

describe("UserSearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.get.mockImplementation((key: string) => key === "tab" ? "users" : null);
    searchParamsMock.toString.mockReturnValue("tab=users");
  });

  it("keeps the users tab and updates only the filter", () => {
    render(<UserSearchBar filter="all" />);

    fireEvent.click(screen.getByRole("button", { name: "参赛过" }));

    expect(replaceMock).toHaveBeenCalledWith("/admin/users?tab=users&filter=participated");
  });

  it("shows a clear action for a non-default filter", () => {
    searchParamsMock.get.mockImplementation((key: string) => key === "tab" ? "users" : key === "filter" ? "none" : null);
    searchParamsMock.toString.mockReturnValue("tab=users&filter=none");
    render(<UserSearchBar filter="none" />);

    expect(screen.getByRole("button", { name: "清除筛选" })).toBeInTheDocument();
  });
});
