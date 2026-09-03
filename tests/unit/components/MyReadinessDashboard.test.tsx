/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyReadinessDashboard } from "@/components/my/MyReadinessDashboard";
import type { MyReadinessModel } from "@/lib/my/readiness";

const item = (title: string, state: "ready" | "unknown" = "ready") => ({
  id: title,
  title,
  state,
  detail: `${title} 说明`,
  owner: "我",
  cta: { href: "/settings", label: `处理${title}` },
});

const model: MyReadinessModel = {
  displayName: "选手甲",
  profile: item("长期个人资料"),
  education: item("教育认证"),
  competitiveProfiles: [{ key: "perfect_world", displayName: "完美世界竞技", state: "ready", blockers: [] }],
  team: item("当前队伍"),
  competitions: [{
    id: "entry-1",
    name: "Rival Five",
    seasonName: "2026 秋季赛",
    href: "/major-2026/register",
    entry: item("当前报名状态"),
    qualification: item("个人竞技资料", "unknown"),
    sanctions: [{
      id: "case-1",
      seasonId: "season-1",
      seasonName: "2026 秋季赛",
      seasonSlug: "major-2026",
      effects: ["registration_block", "roster_block", "match_participation_block"],
      explanation: "公开说明",
      effectiveFrom: new Date("2026-08-01T00:00:00Z"),
      effectiveUntil: null,
    }],
  }],
  sanctions: [{
    id: "case-1",
    seasonId: "season-1",
    seasonName: "2026 秋季赛",
    seasonSlug: "major-2026",
    effects: ["registration_block", "roster_block", "match_participation_block"],
    explanation: "公开说明",
    effectiveFrom: new Date("2026-08-01T00:00:00Z"),
    effectiveUntil: null,
  }],
};

const noTeamModel: MyReadinessModel = {
  ...model,
  team: {
    id: "team",
    title: "当前队伍",
    state: "incomplete",
    detail: "你还没有加入队伍。可以创建自己的队伍，或先查看已有队伍；加入队伍不会自动参加任何赛事。",
    cta: { href: "/my/teams#create-team", label: "创建队伍" },
    secondaryCta: { href: "/teams", label: "查看队伍" },
  },
};

const pendingInvitationModel: MyReadinessModel = {
  ...noTeamModel,
  team: {
    id: "team",
    title: "当前队伍",
    state: "waiting",
    detail: "你有 2 个待处理的队伍邀请。接受邀请即加入队伍，不需要再次申请或等待审核。",
    cta: { href: "/my/teams", label: "处理队伍邀请" },
    secondaryCta: { href: "/teams/recruitment?view=teams", label: "寻找队伍" },
  },
};

describe("MyReadinessDashboard", () => {
  it("shows create and browse actions for users without a Team", () => {
    render(<MyReadinessDashboard model={noTeamModel} />);

    const createLink = screen.getByRole("link", { name: "创建队伍" });
    const browseLink = screen.getByRole("link", { name: "查看队伍" });
    expect(createLink).toHaveAttribute("href", "/my/teams#create-team");
    expect(browseLink).toHaveAttribute("href", "/teams");
    expect(createLink).toHaveClass("bg-primary");
    expect(browseLink).toHaveClass("border-input");
  });

  it("shows pending invitations as the primary no-Team action", () => {
    render(<MyReadinessDashboard model={pendingInvitationModel} />);

    const processLink = screen.getByRole("link", { name: "处理队伍邀请" });
    expect(processLink).toHaveAttribute("href", "/my/teams");
    expect(screen.getByText(/你有 2 个待处理的队伍邀请/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "寻找队伍" })).toHaveAttribute("href", "/teams/recruitment?view=teams");
    expect(processLink).toHaveClass("bg-primary");
  });

  it("keeps existing Team cards to a single management action", () => {
    render(<MyReadinessDashboard model={model} />);

    expect(screen.getByRole("link", { name: "处理当前队伍" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "处理当前队伍" })).toHaveClass("border-input");
    expect(screen.queryByRole("link", { name: "查看队伍" })).not.toBeInTheDocument();
  });

  it("shows the CTA while keeping event requirements distinct from profile readiness", () => {
    render(<MyReadinessDashboard model={model} />);

    expect(screen.getByText(/资料齐全不等于某届赛事一定可报名或出场/)).toBeInTheDocument();
    expect(screen.getByText(/个人竞技资料只说明你的资料/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "处理长期个人资料" })).toHaveAttribute("href", "/settings");
    expect(screen.getByText("暂时无法确认")).toBeInTheDocument();
  });

  it("renders all three sanction effects without private evidence", () => {
    render(<MyReadinessDashboard model={model} />);

    expect(screen.getByText(/阻止报名、阻止进入赛事 roster、阻止单场出场/)).toBeInTheDocument();
    expect(screen.getByText("说明：公开说明")).toBeInTheDocument();
    expect(screen.queryByText(/internalEvidence|私密证据|管理员备注/)).not.toBeInTheDocument();
  });
});
