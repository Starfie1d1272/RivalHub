/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyTeamWorkspace } from "@/components/my/MyTeamWorkspace";
import type { MyCompetitionContext } from "@/lib/my/competitions";
import type { MyTeamWorkspaceModel } from "@/lib/my/team-workspace";

vi.mock("@/actions/teams", () => ({ leaveTeam: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const context: MyCompetitionContext = {
  entryId: "entry-1",
  entryName: "Rival Five",
  teamId: "team-1",
  season: { id: "season-1", name: "2026 秋季赛", slug: "fall-2026", status: "playing" },
  viewerRole: "team_member",
  registration: { label: "已通过", state: "ready", detail: "报名已通过审核。", tone: "success" },
  participation: null,
  primaryAction: { href: "/fall-2026", label: "查看赛事" },
  seasonCreatedAt: new Date("2026-08-01T00:00:00Z"),
  entryUpdatedAt: new Date("2026-08-02T00:00:00Z"),
};

const model: MyTeamWorkspaceModel = {
  kind: "member",
  team: { id: "team-1", slug: "rival-five", name: "Rival Five", logoUrl: null, description: "公开简介", captainUserId: "captain-1", viewerRole: "member" },
  members: [{ id: "membership-1", userId: "captain-1", name: "队长甲", status: "active" }, { id: "membership-2", userId: "user-1", name: "选手乙", status: "active" }],
  competitions: [context],
  history: [],
};

describe("MyTeamWorkspace member composition", () => {
  it("does not expose captain-only controls or disabled captain forms", () => {
    render(<MyTeamWorkspace model={model} />);

    expect(screen.getByRole("heading", { name: "Rival Five", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看赛事" })).toHaveAttribute("href", "/fall-2026");
    expect(screen.getByRole("button", { name: "退出队伍" })).toBeInTheDocument();
    for (const label of ["保存资料", "直接邀请", "发布招募", "交接队长", "解散队伍", "更换队伍图标"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("textbox", { name: "队伍名称" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "简介" })).not.toBeInTheDocument();
  });

  it("explains that leaving the team does not rewrite event rosters", () => {
    render(<MyTeamWorkspace model={model} />);
    fireEvent.click(screen.getByRole("button", { name: "退出队伍" }));
    expect(screen.getByText(/不会自动改写已经提交、审核通过或冻结的赛事名单/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认退出" })).toBeInTheDocument();
  });

  it("shows historical membership status without inferring a past role", () => {
    render(<MyTeamWorkspace model={{ kind: "none", pendingInvitations: [], history: [{ id: "membership-old", teamId: "team-old", teamSlug: "old-team", teamName: "Old Team", status: "left", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-06-01T00:00:00.000Z" }] }} />);

    expect(screen.getByText("Old Team · 已离队")).toBeInTheDocument();
    expect(screen.queryByText("Old Team · 队长")).not.toBeInTheDocument();
    expect(screen.queryByText("Old Team · 成员")).not.toBeInTheDocument();
  });
});
