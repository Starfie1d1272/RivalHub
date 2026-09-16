import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { SeasonWorkspaceOverview } from "@/components/admin/SeasonWorkspaceOverview";
import type { SeasonWorkspaceOverviewData } from "@/lib/admin/season-workspace/types";

const data: SeasonWorkspaceOverviewData = {
  season: {
    id: "season-1",
    slug: "nju-major-2026",
    name: "NJU Major 2026",
    status: "registration",
    competitionTemplate: "major",
    registrationMode: "team",
    registrationOpenedAt: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    rosterChangeClosesAt: null,
    endAt: null,
  },
  summary: {
    pendingApplications: 1,
    approvedEntries: 3,
    formedTeamCount: 3,
    entrantCount: 2,
    frozenEntrantCount: 1,
    matchCount: 0,
    scheduledMatchesWithoutConfirmedLineups: 0,
    finalResultPendingConfirmation: false,
    activeAdjudications: 0,
  },
  registrationFunnel: {
    mode: "team",
    total: 4,
    draft: 1,
    submitted: 1,
    approved: 2,
    deadline: new Date("2026-10-01T00:00:00.000Z"),
    windowPhase: "unscheduled",
  },
  readiness: {
    canStart: false,
    blockers: ["内部检查细节不应直接进入总览。"],
    checks: [{ key: "teams", label: "队伍", state: "blocked", blockers: ["内部检查细节不应直接进入总览。"] }],
    openingPlan: null,
  },
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
    expect(html).toContain("队伍报名漏斗");
    expect(html).toContain("报名总数");
    expect(html).toContain("报名时间待定");
    expect(html).toContain("报名截止");
    expect(html).toContain('href="/admin/nju-major-2026/registrations"');
    expect(html).toContain("进入下一步");
    expect(html).not.toContain("内部检查细节不应直接进入总览");
    expect(html).not.toContain("readiness");
    expect(html).not.toContain("正式开赛确认");
    expect(html).not.toContain("赛事 1–32 种子");
  });

  it("uses a Rivals-specific formed-team metric and personal registration wording", () => {
    const html = renderToStaticMarkup(<SeasonWorkspaceOverview data={{
      ...data,
      season: { ...data.season, slug: "rivals-s1", name: "Rivals S1", competitionTemplate: "rivals", registrationMode: "solo" },
      summary: { ...data.summary, pendingApplications: 8, approvedEntries: 24, formedTeamCount: 4, entrantCount: 0, frozenEntrantCount: 0 },
      registrationFunnel: null,
      nextAction: { label: "处理报名审核", detail: "8 份报名等待管理员处理。", href: "/admin/rivals-s1/registrations" },
    }} />);

    expect(html).toContain("已形成队伍");
    expect(html).toContain(">4<");
    expect(html).not.toContain("正式参赛队");
    expect(html).toContain("待审核报名");
    expect(html).not.toContain("待审核个人报名");
    expect(html).not.toContain("未确认参赛名单");
    expect(html).not.toContain("最终结果待确认");
    expect(html).not.toContain("队伍报名漏斗");
  });
});
