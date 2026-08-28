import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkAdminSessionMock, redirectMock } = vi.hoisted(() => ({
  checkAdminSessionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  checkAdminSession: checkAdminSessionMock,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));
vi.mock("@/db/client", () => ({ db: { select: vi.fn() } }));

import AdminDashboardPage from "@/app/admin/page";

describe("admin dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("redirects unauthenticated requests without reading admin.role", async () => {
    checkAdminSessionMock.mockResolvedValue(null);

    await expect(AdminDashboardPage()).rejects.toThrow("REDIRECT:/admin/login");
    expect(redirectMock).toHaveBeenCalledWith("/admin/login");
  });
});
