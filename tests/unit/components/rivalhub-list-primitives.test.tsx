/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClearFilters, ListSearchField, PaginationControls } from "@/components/rivalhub";
import { applyListQueryUpdates } from "@/components/rivalhub/useListQueryParams";

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

function setQuery(query = "") {
  const values = new URLSearchParams(query);
  searchParamsMock.get.mockImplementation((key: string) => values.get(key));
  searchParamsMock.toString.mockImplementation(() => values.toString());
}

describe("shared list query mechanics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQuery();
  });

  it("preserves unrelated query keys", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("tab=users&filter=all&page=3"),
      { q: "alice" },
      { defaults: { q: "" } },
    );

    expect(result.toString()).toBe("tab=users&filter=all&q=alice");
  });

  it("deletes values equal to caller-provided defaults", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("status=pending&academic=enrolled"),
      { status: "pending", academic: "all" },
      { defaults: { status: "pending", academic: "all" } },
    );

    expect(result.toString()).toBe("");
  });

  it("resets page for filter, search, and sort changes", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("q=old&sort=oldest&page=4"),
      { sort: "newest" },
    );

    expect(result.toString()).toBe("q=old&sort=newest");
  });

  it("keeps filters when page is explicitly updated", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("q=alice&status=pending&page=2"),
      { page: 3 },
    );

    expect(result.toString()).toBe("q=alice&status=pending&page=3");
  });

  it("clears filters back to the default URL", () => {
    setQuery("tab=users&q=alice&filter=participated&page=3");
    render(<ClearFilters defaults={{ q: "", filter: "all" }} routeBase="/admin/users" />);

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    expect(replaceMock).toHaveBeenCalledWith("/admin/users?tab=users");
  });

  it("debounces search and submits only the last value", () => {
    vi.useFakeTimers();
    try {
      render(<ListSearchField queryKey="q" label="搜索用户" routeBase="/admin/users" />);
      const input = screen.getByLabelText("搜索用户");

      fireEvent.change(input, { target: { value: "alice" } });
      fireEvent.change(input, { target: { value: "alice z" } });
      act(() => vi.advanceTimersByTime(299));
      expect(replaceMock).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/admin/users?q=alice+z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("syncs the search input when URL state changes externally", async () => {
    setQuery("q=old");
    const view = render(<ListSearchField queryKey="q" label="搜索用户" routeBase="/admin/users" />);
    expect(screen.getByLabelText("搜索用户")).toHaveValue("old");

    setQuery("q=new");
    view.rerender(<ListSearchField queryKey="q" label="搜索用户" routeBase="/admin/users" />);

    await waitFor(() => expect(screen.getByLabelText("搜索用户")).toHaveValue("new"));
  });

  it("disables pagination controls at the first and last page", () => {
    const view = render(<PaginationControls page={1} totalPages={3} routeBase="/admin/users" />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();

    view.rerender(<PaginationControls page={3} totalPages={3} routeBase="/admin/users" />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });
});
