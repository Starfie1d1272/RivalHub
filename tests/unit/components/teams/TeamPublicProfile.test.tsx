/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";

vi.mock("next/image", () => ({ default: () => null }));

describe("TeamPublicProfile", () => {
  it("keeps core Team facts first and uses shared status presentations", () => {
    render(<TeamPublicProfile
      team={{ name: "Rival Team", logoUrl: null, description: "队伍简介", recruiting: true, status: "active", captainUserId: "captain-1" }}
      currentMembers={[{ id: "member-1", userId: "captain-1", name: "队长甲", status: "active" }, { id: "member-2", userId: "member-1", name: "选手乙", status: "benched" }]}
      entries={[{ id: "entry-1", name: "Rival Entry", status: "approved", seasonName: "2026 秋季赛", seasonSlug: "autumn-2026", createdAt: new Date("2026-08-01T00:00:00Z") }]}
      nameChanges={[{ id: "name-1", oldName: null, newName: "Rival Team", changedAt: new Date("2026-08-01T00:00:00Z") }]}
      captainChanges={[{ id: "captain-1", name: "队长甲", changedAt: new Date("2026-08-01T00:00:00Z") }]}
      playedCount={4}
      wins={3}
      currentUserMembership={{ userId: "captain-1", status: "active" }}
    />);

    expect(screen.getByText("活跃")).toBeInTheDocument();
    expect(screen.getByText("招募中")).toBeInTheDocument();
    expect(screen.getByText("我的队伍 · 队长")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "管理我的队伍" })).toHaveAttribute("href", "/my/teams");
    expect(screen.getAllByText("当前成员").length).toBeGreaterThan(0);
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(screen.getByText("Rival Entry")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2026 秋季赛/ })).toHaveAttribute("href", "/autumn-2026/teams/entry-1");
    expect(screen.getByText("队伍历史")).toBeInTheDocument();
    expect(screen.getByText("名称变更")).toBeInTheDocument();
    expect(screen.getByText("队长变更")).toBeInTheDocument();
  });

  it("shows the requested competition empty state and hides visitor-only management", () => {
    render(<TeamPublicProfile
      team={{ name: "Empty Team", logoUrl: null, description: null, recruiting: false, status: "active", captainUserId: "captain-1" }}
      currentMembers={[]}
      entries={[]}
      nameChanges={[]}
      captainChanges={[]}
      playedCount={0}
      wins={0}
      currentUserMembership={null}
    />);

    expect(screen.getByText("尚无赛事记录。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "管理我的队伍" })).not.toBeInTheDocument();
    expect(screen.getAllByText("暂无变更记录")).toHaveLength(2);
  });
});
