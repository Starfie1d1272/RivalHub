import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const { requireAdminMock, redirectMock, adminSidebarMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  redirectMock: vi.fn(),
  adminSidebarMock: vi.fn(() => null),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: requireAdminMock,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));
vi.mock("@/components/admin/AdminSidebar", () => ({
  AdminSidebar: adminSidebarMock,
}));

import AdminLayout from "@/app/admin/layout";

describe("admin layout access boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("redirects only when the admin session is unauthorized", async () => {
    requireAdminMock.mockRejectedValue(new AppError(ErrorCode.UNAUTHORIZED, "请先登录"));

    await expect(AdminLayout({ children: null })).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("renders a forbidden state for an authenticated non-admin", async () => {
    requireAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const html = renderToStaticMarkup(await AdminLayout({ children: null }));

    expect(html).toContain("权限不足");
    expect(html).toContain("当前账号已登录");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(adminSidebarMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected authorization failures", async () => {
    const loaderError = new Error("database unavailable");
    requireAdminMock.mockRejectedValue(loaderError);

    await expect(AdminLayout({ children: null })).rejects.toBe(loaderError);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
