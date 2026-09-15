import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformOperationsOverview as PlatformOperationsOverviewData } from "@/lib/admin/platform-operations/types";

const { resolveAdminPageAccessMock, requireAdminMock, getOverviewMock } = vi.hoisted(() => ({
  resolveAdminPageAccessMock: vi.fn(),
  requireAdminMock: vi.fn(),
  getOverviewMock: vi.fn(),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  resolveAdminPageAccess: resolveAdminPageAccessMock,
}));
vi.mock("@/lib/auth/session", () => ({
  requireAdmin: requireAdminMock,
}));
vi.mock("@/lib/admin/platform-operations/overview", () => ({
  getPlatformOperationsOverview: getOverviewMock,
}));

import PlatformOperationsAdminPage from "@/app/admin/operations/page";

const data: PlatformOperationsOverviewData = {
  asOf: "2026-09-15T04:00:00.000Z",
  population: { activeUsers: 1, activeUsers24h: 1, activeUsers7d: 1, activeUsers30d: 1, certifiedUsers: 0, activeTeams: 0 },
  playerPool: { currentTeamUsers: 0, certifiedWithoutTeam: 0, teamWithoutCertification: 0, publicPlayerLft: 0, publicTeamRecruiting: 0 },
  teams: { activeTeamCount: 0, totalMemberCount: 0, medianTeamSize: null, sizeDistribution: [] },
  growth: [],
};

describe("admin platform operations page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("uses the admin authorization boundary before loading platform data", async () => {
    resolveAdminPageAccessMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await PlatformOperationsAdminPage());

    expect(resolveAdminPageAccessMock).toHaveBeenCalledWith(requireAdminMock);
    expect(html).toContain("权限不足");
    expect(getOverviewMock).not.toHaveBeenCalled();
  });

  it("loads the platform read model only after admin access is granted", async () => {
    resolveAdminPageAccessMock.mockResolvedValue({ role: "super_admin", seasonIds: [] });
    getOverviewMock.mockResolvedValue(data);

    const html = renderToStaticMarkup(await PlatformOperationsAdminPage());

    expect(getOverviewMock).toHaveBeenCalledOnce();
    expect(html).toContain("运营概览");
  });
});
