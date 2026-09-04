import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAdminPageAccessMock, requireSuperAdminMock, userFindFirstMock } = vi.hoisted(() => ({
  resolveAdminPageAccessMock: vi.fn(),
  requireSuperAdminMock: vi.fn(),
  userFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  resolveAdminPageAccess: resolveAdminPageAccessMock,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
}));
vi.mock("@/db/client", () => ({
  db: { query: { users: { findFirst: userFindFirstMock } } },
}));

import AdminSettingsPage from "@/app/admin/settings/page";

describe("global system status access boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("uses the super-admin authorization owner", async () => {
    resolveAdminPageAccessMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await AdminSettingsPage());

    expect(resolveAdminPageAccessMock).toHaveBeenCalledWith(requireSuperAdminMock);
    expect(html).toContain("权限不足");
    expect(userFindFirstMock).not.toHaveBeenCalled();
  });

  it("labels the retained environment page as system status", async () => {
    resolveAdminPageAccessMock.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
    userFindFirstMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await AdminSettingsPage());

    expect(html).toContain("系统状态");
    expect(html).toContain("环境变量状态");
  });
});
