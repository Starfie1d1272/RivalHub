import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadOverviewMock } = vi.hoisted(() => ({ loadOverviewMock: vi.fn() }));

vi.mock("@/lib/admin/season-workspace/overview", () => ({
  loadSeasonWorkspaceOverview: loadOverviewMock,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

import AdminSeasonOverviewPage from "@/app/admin/[seasonSlug]/page";

describe("AdminSeasonOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    loadOverviewMock.mockResolvedValue({
      season: {
        id: "season-1",
        slug: "nju-major-2026",
        name: "NJU Major 2026",
        status: "playing",
        competitionTemplate: "major",
        registrationMode: "team",
        registrationOpenedAt: new Date("2026-08-01T00:00:00.000Z"),
        registrationOpensAt: null,
        registrationClosesAt: null,
        rosterChangeClosesAt: null,
        endAt: null,
      },
      summary: {
        pendingApplications: 0,
        approvedEntries: 0,
        formedTeamCount: 0,
        entrantCount: 0,
        frozenEntrantCount: 0,
        matchCount: 0,
        unresolvedPrestartIssues: 0,
        scheduledMatchesWithoutConfirmedLineups: 0,
        finalResultPendingConfirmation: false,
        activeAdjudications: 0,
      },
      readiness: null,
      nextAction: { label: "查看赛事工作区", detail: "继续当前运营流程。", href: "/admin/nju-major-2026/prestart" },
    });
  });

  it("loads and renders only the overview surface", async () => {
    const html = renderToStaticMarkup(await AdminSeasonOverviewPage({ params: Promise.resolve({ seasonSlug: "nju-major-2026" }) }));

    expect(loadOverviewMock).toHaveBeenCalledWith("nju-major-2026");
    expect(html).toContain("NJU Major 2026");
    expect(html).toContain("进入下一步");
    expect(html).not.toContain("赛事 1–32 种子");
    expect(html).not.toContain("正式开赛确认");
    expect(html).not.toContain("赛事归档");
  });
});
