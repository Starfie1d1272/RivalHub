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

  it("marks the canonical active destination in the rendered sidebar", () => {
    pathnameMock.mockReturnValue("/admin/competitive-seasons/conversion-policies/123");
    const html = renderToStaticMarkup(<AdminSidebar email="admin@example.com" role="super_admin" />);
    const document = new DOMParser().parseFromString(html, "text/html");
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe("/admin/competitive-seasons/conversion-policies");
  });

  it("hides global capabilities from a season admin", () => {
    const html = renderToStaticMarkup(<AdminSidebar email="admin@example.com" role="season_admin" />);

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

    expect(html).toContain('href="/admin/users"');
    expect(html).toContain('href="/admin/education-verifications"');
    expect(html).toContain('href="/admin/invites"');
    expect(html).toContain('href="/admin/competitive-seasons"');
    expect(html).toContain('href="/admin/competitive-seasons/conversion-policies"');
    expect(html).toContain('href="/admin/logs"');
    expect(html).toContain('href="/admin/settings"');
  });
});
