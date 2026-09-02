/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogView } from "@/lib/audit/presentation";

const { fetchAuditLogsMock, pushMock, searchParamsMock } = vi.hoisted(() => ({
  fetchAuditLogsMock: vi.fn(),
  pushMock: vi.fn(),
  searchParamsMock: { get: vi.fn(), toString: vi.fn() },
}));

vi.mock("@/actions/audit", () => ({ fetchAuditLogs: fetchAuditLogsMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));

import { AuditLogTable } from "@/components/admin/AuditLogTable";

const knownLog: AuditLogView = {
  id: "log-1",
  createdAt: "2026-09-02T12:00:00.000Z",
  actionKey: "education_verification.approved",
  actionLabel: "通过教育认证审核",
  categoryLabel: "教育认证",
  categoryColor: "var(--color-ok)",
  actorLabel: "管理员甲",
  targetTypeLabel: "教育认证",
  targetLabel: "认证 · 玩家甲 · 南京大学",
  summary: "含审核备注",
};

const unknownLog: AuditLogView = {
  ...knownLog,
  id: "log-2",
  actionKey: "future.internal_action",
  actionLabel: "未知操作",
  categoryLabel: "其他",
  categoryColor: "var(--color-fg-dim)",
  summary: null,
};

function setQuery(values: Record<string, string> = {}) {
  searchParamsMock.get.mockImplementation((key: string) => values[key] ?? null);
  searchParamsMock.toString.mockImplementation(() => new URLSearchParams(values).toString());
}

function renderTable(logs: AuditLogView[] = [knownLog, unknownLog]) {
  return render(
    <AuditLogTable
      initialLogs={logs}
      initialTotal={logs.length}
      seasons={[{ id: "season-1", name: "Major 2027" }]}
    />,
  );
}

describe("AuditLogTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQuery();
    fetchAuditLogsMock.mockResolvedValue({ success: true, data: { logs: [knownLog, unknownLog], total: 2 } });
  });

  it("renders safe presentation fields and no permanent raw-details column", () => {
    const { container } = renderTable();

    expect(screen.getAllByText("通过教育认证审核").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("未知操作")).toBeInTheDocument();
    expect(screen.queryByText("future.internal_action")).not.toBeInTheDocument();
    expect(screen.getAllByText("认证 · 玩家甲 · 南京大学").length).toBe(2);
    expect(screen.getByText("含审核备注")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "摘要" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "详情" })).not.toBeInTheDocument();
    expect(screen.queryByText("展开")).not.toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.getByRole("option", { name: "通过教育认证审核" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "更新竞技段位资料" })).toBeInTheDocument();
  });

  it("keeps date filters wide enough to wrap on small screens", () => {
    const { container } = renderTable([knownLog]);
    const dateInputs = container.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
    for (const input of dateInputs) {
      expect(input).toHaveClass("min-w-0");
      expect(input.parentElement).toHaveClass("min-w-0");
    }
    expect(dateInputs[0]?.parentElement?.parentElement).toHaveClass("lg:col-span-6");
  });

  it("preserves successful rows and reports reload failure", async () => {
    const { rerender } = renderTable();
    fetchAuditLogsMock.mockResolvedValueOnce({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "内部错误" },
    });

    fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2026-09-01" } });
    setQuery({ dateFrom: "2026-09-01" });
    rerender(
      <AuditLogTable
        initialLogs={[knownLog, unknownLog]}
        initialTotal={2}
        seasons={[{ id: "season-1", name: "Major 2027" }]}
      />,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("操作日志加载失败"));
    expect(screen.getAllByText("通过教育认证审核").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("暂无日志记录")).not.toBeInTheDocument();
  });

  it("distinguishes a true empty result from a load error", () => {
    fetchAuditLogsMock.mockResolvedValue({ success: true, data: { logs: [], total: 0 } });
    renderTable([]);

    expect(screen.getByText("暂无日志记录")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
