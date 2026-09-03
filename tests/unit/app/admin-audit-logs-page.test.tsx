/** @vitest-environment jsdom */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchAuditLogsMock,
  getAuditSeasonsMock,
  resolveAdminPageAccessMock,
  seasonFindFirstMock,
  notFoundMock,
} = vi.hoisted(() => ({
  fetchAuditLogsMock: vi.fn(),
  getAuditSeasonsMock: vi.fn(),
  resolveAdminPageAccessMock: vi.fn(),
  seasonFindFirstMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/actions/audit", () => ({
  fetchAuditLogs: fetchAuditLogsMock,
  getAuditSeasons: getAuditSeasonsMock,
}));
vi.mock("@/lib/auth/admin-access", () => ({ resolveAdminPageAccess: resolveAdminPageAccessMock }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: vi.fn(), requireSeasonAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { seasons: { findFirst: seasonFindFirstMock } } } }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/components/admin/AuditLogTable", () => ({
  AuditLogTable: ({ initialLogs }: { initialLogs: unknown[] }) => React.createElement("div", { "data-testid": "audit-log-table" }, String(initialLogs.length)),
}));

import AdminLogsPage from "@/app/admin/logs/page";
import SeasonAuditLogPage from "@/app/admin/[seasonSlug]/logs/page";

const data = { logs: [], total: 0 };

describe("audit log pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    resolveAdminPageAccessMock.mockResolvedValue(true);
    seasonFindFirstMock.mockResolvedValue({ id: "season-1", name: "Major 2027" });
    fetchAuditLogsMock.mockResolvedValue({ success: true, data });
    getAuditSeasonsMock.mockResolvedValue({ success: true, data: [{ id: "season-1", name: "Major 2027" }] });
  });

  it("renders an explicit error instead of an empty table when logs fail", async () => {
    fetchAuditLogsMock.mockResolvedValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "操作日志加载失败。" },
    });

    const page = await AdminLogsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("无法加载操作日志");
    expect(html).toContain("INTERNAL_ERROR");
    expect(html).not.toContain("暂无日志记录");
    expect(html).not.toContain("audit-log-table");
  });

  it("renders an explicit error when season filter options fail", async () => {
    getAuditSeasonsMock.mockResolvedValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "赛季筛选加载失败。" },
    });

    const page = await AdminLogsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("无法加载赛季筛选项");
    expect(html).toContain("赛季筛选加载失败。");
    expect(html).not.toContain("暂无日志记录");
  });

  it("uses a wide global admin page and preserves the success DTO", async () => {
    const page = await AdminLogsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("max-w-6xl");
    expect(html).not.toContain("max-w-4xl");
    expect(html).toContain('data-testid="audit-log-table"');
  });

  it("keeps season-scoped log failures explicit", async () => {
    fetchAuditLogsMock.mockResolvedValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "赛事日志暂不可用。" },
    });

    const page = await SeasonAuditLogPage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("无法加载赛事操作日志");
    expect(html).toContain("赛事日志暂不可用。");
    expect(html).not.toContain("暂无日志记录");
  });
});
