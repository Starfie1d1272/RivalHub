import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformOperationsOverview } from "@/components/admin/PlatformOperationsOverview";
import type { PlatformOperationsOverview as PlatformOperationsOverviewData } from "@/lib/admin/platform-operations/types";

const data: PlatformOperationsOverviewData = {
  asOf: "2026-09-15T04:00:00.000Z",
  population: {
    activeUsers: 42,
    activeUsers24h: 8,
    activeUsers7d: 20,
    activeUsers30d: 31,
    certifiedUsers: 15,
    activeTeams: 6,
  },
  playerPool: {
    currentTeamUsers: 18,
    certifiedWithoutTeam: 7,
    teamWithoutCertification: 3,
    publicPlayerLft: 4,
    publicTeamRecruiting: 2,
  },
  teams: {
    activeTeamCount: 6,
    totalMemberCount: 18,
    medianTeamSize: 3.5,
    sizeDistribution: [
      { key: "0", label: "0 人", count: 0 },
      { key: "1", label: "1 人", count: 1 },
      { key: "2", label: "2 人", count: 1 },
      { key: "3", label: "3 人", count: 1 },
      { key: "4", label: "4 人", count: 0 },
      { key: "5", label: "5 人", count: 0 },
      { key: "6", label: "6 人", count: 0 },
      { key: "7", label: "7 人", count: 0 },
      { key: "8", label: "8 人", count: 0 },
      { key: "9", label: "9 人", count: 0 },
      { key: "10-plus", label: "10+ 人", count: 2 },
    ],
  },
  growth: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(index + 9).padStart(2, "0")}`,
    label: `${index + 9}月${index + 9}日`,
    newUsers: index === 6 ? 2 : 0,
    newEducationApprovals: 0,
    newTeams: 0,
    newMemberships: 0,
  })),
};

describe("PlatformOperationsOverview", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("renders aggregate platform facts in a wide standalone admin layout", () => {
    const html = renderToStaticMarkup(<PlatformOperationsOverview data={data} />);

    expect(html).toContain('data-layout-variant="wide"');
    expect(html).toContain("运营概览");
    expect(html).toContain("平台人口");
    expect(html).toContain("玩家池结构");
    expect(html).toContain("队伍成员人数分布");
    expect(html).toContain("组队大厅");
    expect(html).toContain('href="/teams/recruitment"');
    expect(html).toContain("平台增长 · 最近 7 天");
    expect(html).toContain("7 日活跃用户");
    expect(html).toContain("已教育认证用户");
    expect(html).toContain("当前有效平台用户");
    expect(html).toContain("当前队伍");
    expect(html).toContain("认证且当前无队伍");
    expect(html).toContain("选手找队");
    expect(html).toContain("队伍招募");
    expect(html).toContain("按用户去重");
    expect(html).not.toContain("活跃队伍");
    expect(html).not.toContain("Player LFT");
    expect(html).not.toContain("Team Recruiting");
    expect(html).not.toContain("distinct");
    expect(html).toContain("10+ 人");
    expect(html).toContain("Asia/Shanghai");
    expect(html).not.toContain("Auth");
    expect(html).not.toContain("Vercel");
    expect(html).not.toContain("预测");
    expect(html).not.toContain("邀请转化");
  });
});
