/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClearFilters, ListSearchField, PaginationControls } from "@/components/rivalhub";
import { applyListQueryUpdates, useListQueryParams } from "@/components/rivalhub/useListQueryParams";

const { pushMock, replaceMock, searchState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  searchState: {
    current: {
      get: () => null as string | null,
      toString: () => "",
    } as { get: (key: string) => string | null; toString: () => string },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/admin/users",
  useSearchParams: () => searchState.current,
}));

function setQuery(query = "") {
  const values = new URLSearchParams(query);
  searchState.current = {
    get: (key: string) => values.get(key),
    toString: () => values.toString(),
  };
}

const TEST_QUERY_DEFAULTS = { status: "pending" } as const;

function TestListController() {
  const { searchParams, update } = useListQueryParams({ routeBase: "/admin/users", defaults: TEST_QUERY_DEFAULTS });
  return (
    <>
      <ListSearchField
        queryKey="q"
        label="搜索用户"
        value={searchParams.get("q") ?? ""}
        onDebouncedChange={(value) => update({ q: value })}
      />
      <button type="button" onClick={() => update({ status: "approved" })}>切换状态</button>
    </>
  );
}

const CLEAR_QUERY_DEFAULTS = { q: "", filter: "all" } as const;
const TEST_SURFACE_DEFAULTS = { q: "", status: "pending" } as const;

function TestClearFilters() {
  const { searchParams, update } = useListQueryParams({ routeBase: "/admin/users", defaults: CLEAR_QUERY_DEFAULTS });
  return (
    <ClearFilters
      defaults={CLEAR_QUERY_DEFAULTS}
      searchParams={searchParams}
      onClear={(updates) => update(updates)}
    />
  );
}

function TestListSurface() {
  const { searchParams, update } = useListQueryParams({ routeBase: "/admin/users", defaults: TEST_SURFACE_DEFAULTS });
  const pageValue = Number(searchParams.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  return (
    <>
      <ListSearchField
        queryKey="q"
        label="搜索用户"
        value={searchParams.get("q") ?? ""}
        onDebouncedChange={(value) => update({ q: value })}
      />
      <ClearFilters
        defaults={TEST_SURFACE_DEFAULTS}
        searchParams={searchParams}
        onClear={(updates) => update(updates)}
      />
      <PaginationControls
        page={page}
        totalPages={3}
        onPageChange={(nextPage) => update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })}
      />
    </>
  );
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
    render(<TestClearFilters />);

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    expect(replaceMock).toHaveBeenCalledWith("/admin/users?tab=users");
  });

  it("does not mark omitted default filters as active", () => {
    render(
      <ClearFilters
        defaults={{ status: "pending", sort: "oldest" }}
        searchParams={searchState.current}
        onClear={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "清除筛选" })).not.toBeInTheDocument();
  });

  it("debounces search and submits only the last value", () => {
    vi.useFakeTimers();
    try {
      const onDebouncedChange = vi.fn();
      render(<ListSearchField queryKey="q" label="搜索用户" value="" onDebouncedChange={onDebouncedChange} />);
      const input = screen.getByLabelText("搜索用户");

      fireEvent.change(input, { target: { value: "a" } });
      expect(input).toHaveValue("a");
      fireEvent.change(input, { target: { value: "alice" } });
      expect(input).toHaveValue("alice");
      act(() => vi.advanceTimersByTime(299));
      expect(onDebouncedChange).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));

      expect(onDebouncedChange).toHaveBeenCalledTimes(1);
      expect(onDebouncedChange).toHaveBeenCalledWith("alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bases delayed search updates on the latest URL snapshot", () => {
    vi.useFakeTimers();
    try {
      setQuery("status=pending");
      render(<TestListController />);

      fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "alice" } });
      fireEvent.click(screen.getByRole("button", { name: "切换状态" }));
      expect(replaceMock).toHaveBeenLastCalledWith("/admin/users?status=approved");
      act(() => vi.advanceTimersByTime(300));

      expect(replaceMock).toHaveBeenLastCalledWith("/admin/users?status=approved&q=alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("syncs the search input when URL state changes externally", () => {
    setQuery("q=old");
    const onDebouncedChange = vi.fn();
    const view = render(<ListSearchField queryKey="q" label="搜索用户" value="old" onDebouncedChange={onDebouncedChange} />);
    expect(screen.getByLabelText("搜索用户")).toHaveValue("old");

    view.rerender(<ListSearchField queryKey="q" label="搜索用户" value="new" onDebouncedChange={onDebouncedChange} />);

    expect(screen.getByLabelText("搜索用户")).toHaveValue("new");
  });

  it("composes delayed search with clear filters through one controller", () => {
    vi.useFakeTimers();
    try {
      setQuery("q=old&status=approved&page=2");
      render(<TestListSurface />);

      fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "alice" } });
      fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
      expect(replaceMock).toHaveBeenLastCalledWith("/admin/users");

      act(() => vi.advanceTimersByTime(300));
      expect(replaceMock).toHaveBeenLastCalledWith("/admin/users?q=alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("composes delayed search with pagination through one controller", () => {
    vi.useFakeTimers();
    try {
      setQuery("q=old&page=1");
      render(<TestListSurface />);

      fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "alice" } });
      fireEvent.click(screen.getByRole("button", { name: "下一页" }));
      expect(pushMock).toHaveBeenLastCalledWith("/admin/users?q=old&page=2");

      act(() => vi.advanceTimersByTime(300));
      expect(replaceMock).toHaveBeenLastCalledWith("/admin/users?q=alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables pagination controls at the first and last page", () => {
    const onPageChange = vi.fn();
    const view = render(<PaginationControls page={1} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    view.rerender(<PaginationControls page={3} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it("omits page when navigating back to the first page", () => {
    setQuery("q=alice&page=2");
    render(<TestListSurface />);

    fireEvent.click(screen.getByRole("button", { name: "上一页" }));

    expect(pushMock).toHaveBeenCalledWith("/admin/users?q=alice");
  });
});
