import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUserSession } from "tests/helpers";
import { AppError, ErrorCode } from "@/lib/errors";

const { seasonFindFirstMock, requireSeasonAdminMock, getSeasonSanctionsMock, notFoundMock, redirectMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
  getSeasonSanctionsMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
}));

vi.mock("@/actions/discipline", () => ({
  getSeasonSanctions: getSeasonSanctionsMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/admin/major-2027/discipline",
  useSearchParams: () => ({ get: () => null, toString: () => "" }),
}));

import AdminDisciplinePage from "@/app/admin/[seasonSlug]/discipline/page";

describe("admin discipline page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    seasonFindFirstMock.mockResolvedValue({ id: "season-1", name: "RivalHub Major 2027" });
    requireSeasonAdminMock.mockResolvedValue(mockUserSession({ role: "super_admin" }));
    getSeasonSanctionsMock.mockResolvedValue({
      success: true as const,
      data: {
        rows: [
          {
            id: "case-1",
            subjectUserId: "user-1",
            subjectLabel: "玩家甲",
            storedStatus: "active",
            resolvedStatus: "active",
            effects: ["registration_block", "roster_block"],
            internalEvidence: "私密证据：聊天记录截图链接 https://internal.example/secret",
            publicExplanation: "违反赛场行为规范",
            effectiveFrom: "2026-08-01T00:00:00.000Z",
            effectiveUntil: null,
            revokedAt: null,
            revocationReason: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        normalizedQuery: { status: "active", sort: "newest", page: 1, pageSize: 25 },
        hasAnyRecords: true,
      },
    });
  });

  it("renders season sanctions with resolved status and admin-only internal evidence", async () => {
    const page = await AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("纪律处罚管理 · RivalHub Major 2027");
    expect(html).toContain("玩家甲");
    expect(html).toContain("私密证据：聊天记录截图链接");
    expect(html).toContain("违反赛场行为规范");
    expect(html).toContain("生效中");
    expect(html).toContain("参赛拦截");
  });

  it("renders an explicit error state when loading sanctions fails", async () => {
    getSeasonSanctionsMock.mockResolvedValue({
      success: false as const,
      error: { code: "FORBIDDEN", message: "没有权限执行该操作。" },
    });
    const page = await AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("无法加载纪律处罚记录");
    expect(html).toContain("FORBIDDEN");
    expect(html).toContain("没有权限执行该操作。");
  });

  it("redirects an unauthenticated user to login", async () => {
    requireSeasonAdminMock.mockRejectedValue(new AppError(ErrorCode.UNAUTHORIZED, "请先登录"));
    await expect(AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("renders a forbidden state for an authenticated user without season access", async () => {
    requireSeasonAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const page = await AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("权限不足");
    expect(html).toContain("当前账号已登录");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(getSeasonSanctionsMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected season authorization failures", async () => {
    const loaderError = new Error("database unavailable");
    requireSeasonAdminMock.mockRejectedValue(loaderError);

    await expect(AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) })).rejects.toBe(loaderError);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected page loader failures after authorization", async () => {
    const loaderError = new Error("sanctions loader unavailable");
    getSeasonSanctionsMock.mockRejectedValue(loaderError);

    await expect(AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) })).rejects.toBe(loaderError);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("404s for unknown season slug", async () => {
    seasonFindFirstMock.mockResolvedValue(undefined);
    await expect(AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
