import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const { requireAdminMock, redirectMock, selectMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  redirectMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: requireAdminMock,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));
vi.mock("@/db/client", () => ({ db: { select: selectMock } }));

import AdminDashboardPage from "@/app/admin/page";

const seasonId = "00000000-0000-0000-0000-000000000001";

function makeSeason(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: seasonId,
    slug: "nju-major-2026",
    name: "NJU Major 2026",
    status: "playing",
    registrationOpenedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    hasDraft: true,
    hasCaptainVoting: true,
    ...overrides,
  };
}

function mockSeasonRows(rows: unknown[]) {
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({ orderBy: async () => rows }),
      orderBy: async () => rows,
    }),
  }));
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await AdminDashboardPage());
}

describe("admin dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("redirects unauthenticated requests without reading admin.role", async () => {
    requireAdminMock.mockRejectedValue(new AppError(ErrorCode.UNAUTHORIZED, "请先登录"));

    await expect(AdminDashboardPage()).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("renders a forbidden state for an authenticated non-admin", async () => {
    requireAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const html = await renderPage();

    expect(html).toContain("权限不足");
    expect(html).toContain("当前账号已登录");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("renders a lifecycle directory card with a workspace CTA", async () => {
    requireAdminMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason()]);

    const html = await renderPage();

    expect(html).toContain('href="/admin/nju-major-2026">NJU Major 2026');
    expect(html).toContain("进行中");
    expect(html).toContain('href="/admin/nju-major-2026">进入赛事工作区 →');
  });

  it("does not duplicate season operations in the global directory", async () => {
    requireAdminMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason()]);

    const html = await renderPage();

    expect(html).not.toContain('href="/admin/nju-major-2026/matches"');
    expect(html).not.toContain('href="/admin/nju-major-2026/registrations"');
    expect(html).not.toContain('href="/admin/nju-major-2026/draft"');
    expect(html).not.toContain('href="/admin/nju-major-2026/captains"');
    expect(html).not.toContain('href="/admin/nju-major-2026/settings"');
  });

  it("groups seasons by the canonical lifecycle presentation", async () => {
    requireAdminMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([
      makeSeason({ id: "active", name: "进行中赛事", status: "playing" }),
      makeSeason({ id: "upcoming", name: "待开放赛事", status: "registration", registrationOpenedAt: null }),
      makeSeason({ id: "draft", name: "草稿赛事", status: "draft" }),
      makeSeason({ id: "recent", name: "最近赛事", status: "finished" }),
      makeSeason({ id: "archived", name: "归档赛事", status: "archived" }),
    ]);

    const html = await renderPage();

    expect(html).toContain("进行中");
    expect(html).toContain("即将开始");
    expect(html).toContain("草稿");
    expect(html).toContain("最近结束");
    expect(html).toContain("已归档");
    expect(html).toContain("已发布 · 报名未开放");
  });

  it("keeps the workspace entry for a finished season without season operations", async () => {
    requireAdminMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason({ status: "finished" })]);

    const html = await renderPage();

    expect(html).toContain('href="/admin/nju-major-2026">进入赛事工作区 →');
    expect(html).not.toContain('href="/admin/nju-major-2026/matches"');
    expect(html).not.toContain('href="/admin/nju-major-2026/registrations"');
    expect(html).not.toContain('href="/admin/nju-major-2026/settings"');
    expect(html).toContain("最近结束");
  });

  it("hides new-season actions from a season admin", async () => {
    requireAdminMock.mockResolvedValue({
      role: "user",
      seasonIds: [seasonId],
    });
    mockSeasonRows([makeSeason()]);

    const html = await renderPage();

    expect(html).not.toContain('href="/admin/seasons/new"');
    expect(html).toContain('href="/admin/nju-major-2026">进入赛事工作区 →');
  });

  it("shows the empty state when a season admin has no assigned seasons", async () => {
    requireAdminMock.mockResolvedValue({
      role: "user",
      seasonIds: [],
    });
    mockSeasonRows([]);

    const html = await renderPage();

    expect(html).toContain("暂无可管理的赛事");
  });
});
