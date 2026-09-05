/** @vitest-environment jsdom */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameMock, logoutUserMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(),
  logoutUserMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: pathnameMock,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/actions/auth", () => ({ logoutUser: logoutUserMock }));

import { AdminSidebar } from "@/components/admin/AdminSidebar";

describe("AdminSidebar role visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue("/admin");
  });

  it("shows only the season directory to a season admin", () => {
    const html = renderToStaticMarkup(<AdminSidebar email="admin@example.com" role="season_admin" />);

    expect(html).toContain("赛事");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain('href="/admin/users"');
    expect(html).not.toContain('href="/admin/education-verifications"');
    expect(html).not.toContain('href="/admin/invites"');
    expect(html).not.toContain('href="/admin/competitive-seasons"');
    expect(html).not.toContain('href="/admin/logs"');
    expect(html).not.toContain('href="/admin/settings"');
  });

  it("shows every global capability to a super admin", () => {
    const html = renderToStaticMarkup(<AdminSidebar email="admin@example.com" role="super_admin" />);

    expect(html).toContain("用户与权限");
    expect(html).toContain("教育认证");
    expect(html).toContain("竞技平台");
    expect(html).toContain("操作日志");
    expect(html).toContain("系统状态");
    expect(html).toContain('href="/admin/users"');
    expect(html).toContain('href="/admin/education-verifications"');
    expect(html).toContain('href="/admin/invites"');
    expect(html).toContain('href="/admin/competitive-seasons"');
    expect(html).toContain('href="/admin/logs"');
    expect(html).toContain('href="/admin/settings"');
  });
});
