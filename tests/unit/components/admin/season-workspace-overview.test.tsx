import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { SeasonWorkspaceOverview } from "@/components/admin/SeasonWorkspaceOverview";
import type { SeasonWorkspaceOverviewData } from "@/lib/admin/season-workspace";

const data: SeasonWorkspaceOverviewData = {
  season: {
    id: "season-1",
    slug: "nju-major-2026",
    name: "NJU Major 2026",
    status: "registration",
    competitionTemplate: "major",
    registrationOpenedAt: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    rosterChangeClosesAt: null,
    endAt: null,
  },
  summary: {
    pendingApplications: 1,
    approvedEntries: 3,
    entrantCount: 2,
    frozenEntrantCount: 1,
    matchCount: 0,
    stageRunCount: 0,
    unresolvedPrestartIssues: 2,
    scheduledMatchesWithoutConfirmedLineups: 0,
    finalResultPendingConfirmation: false,
    activeAdjudications: 0,
  },
  readiness: null,
  nextAction: {
    label: "处理报名审核",
    detail: "1 份报名等待管理员处理。",
    href: "/admin/nju-major-2026/registrations",
  },
};

describe("SeasonWorkspaceOverview", () => {
  it("presents lifecycle, summary and one next-step CTA without rendering the old editor", () => {
    const html = renderToStaticMarkup(<SeasonWorkspaceOverview data={data} />);

    expect(html).toContain("NJU Major 2026");
    expect(html).toContain("已发布 · 报名未开放");
    expect(html).toContain("正式参赛队");
    expect(html).toContain('href="/admin/nju-major-2026/registrations"');
    expect(html).toContain("进入下一步");
    expect(html).not.toContain("正式开赛确认");
    expect(html).not.toContain("赛事 1–32 种子");
  });
});
