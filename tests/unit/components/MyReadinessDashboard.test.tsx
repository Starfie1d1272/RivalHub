/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyReadinessDashboard } from "@/components/my/MyReadinessDashboard";
import type { MyCompetitionContext } from "@/lib/my/competitions";
import type { MyReadinessItem, MyReadinessModel } from "@/lib/my/readiness";
import type { MyWorkspaceModel } from "@/lib/my/workspace";

function item(title: string, state: MyReadinessItem["state"] = "ready", responsibility?: MyReadinessItem["responsibility"]): MyReadinessItem {
  return { id: title, title, state, detail: `${title} 说明`, ...(responsibility ? { responsibility } : {}), cta: { href: `/settings/${title}`, label: `处理${title}` } };
}

const context: MyCompetitionContext = {
  entryId: "entry-1",
  entryName: "Rival Five",
  teamId: "team-1",
  season: { id: "season-1", name: "2026 秋季赛", slug: "fall-2026", status: "registration" },
  viewerRole: "participant",
  registration: { label: "待审核", state: "waiting", detail: "报名已提交。", tone: "info" },
  participation: { label: "已确认参赛", state: "ready", detail: "已确认。", tone: "success" },
  primaryAction: { href: "/fall-2026/register", label: "查看本届报名" },
  seasonCreatedAt: new Date("2026-08-01T00:00:00Z"),
  entryUpdatedAt: new Date("2026-08-02T00:00:00Z"),
};

const readiness: MyReadinessModel = {
  displayName: "选手甲",
  profile: item("个人资料"),
  education: item("教育认证"),
  competitiveProfiles: [{ key: "perfect_world", displayName: "完美世界竞技", state: "ready", blockers: [] }],
  team: item("当前队伍"),
  competitions: [{ id: "entry-1", name: "Rival Five", seasonName: "2026 秋季赛", href: "/fall-2026/register", entry: item("当前报名状态"), qualification: item("个人竞技资料"), sanctions: [] }],
  sanctions: [],
};

const model: MyWorkspaceModel = {
  displayName: "选手甲",
  tasks: [],
  upcomingMatches: [],
  currentTeam: null,
  currentCompetitions: [context],
  historyCompetitions: [],
  readiness,
  sanctions: [],
};

describe("MyReadinessDashboard", () => {
  it("puts actionable tasks before current participation", () => {
    const task = item("确认参赛", "waiting", "self");
    render(<MyReadinessDashboard model={{ ...model, tasks: [task] }} />);
    const taskHeading = screen.getByRole("heading", { name: "需要你处理" });
    const currentHeading = screen.getByRole("heading", { name: "当前参与" });
    expect(taskHeading.compareDocumentPosition(currentHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("link", { name: "处理确认参赛" })).toHaveAttribute("href", "/settings/确认参赛");
  });

  it("does not show an admin-only waiting item as a user task", () => {
    render(<MyReadinessDashboard model={{ ...model, tasks: [] }} />);
    expect(screen.getByText("当前没有待处理事项")).toBeInTheDocument();
    expect(screen.queryByText(/等待赛事管理员处理/)).not.toBeInTheDocument();
  });

  it("renders shared responsibility without duplicating the owner phrase", () => {
    const tasks = [
      item("资料与审核", "waiting", "self_and_admin"),
      item("赛事负责人处理", "waiting", "representative"),
      item("负责人和管理员处理", "waiting", "representative_and_admin"),
      item("管理员处理", "waiting", "admin"),
    ];
    render(<MyReadinessDashboard model={{ ...model, tasks }} />);

    expect(screen.getByText("需要你与赛事管理员共同处理")).toBeInTheDocument();
    expect(screen.getByText("等待赛事负责人处理")).toBeInTheDocument();
    expect(screen.getByText("等待赛事负责人和赛事管理员处理")).toBeInTheDocument();
    expect(screen.getByText("等待赛事管理员处理")).toBeInTheDocument();
  });

  it("keeps member team identity and event participation separate", () => {
    render(<MyReadinessDashboard model={{ ...model, currentTeam: { id: "team-1", slug: "rival-five", name: "Rival Five", logoUrl: null, description: null, captainUserId: "captain-1", viewerRole: "member" } }} />);
    expect(screen.getByText((_content, element) => element?.textContent === "你是成员；队伍成员变更不会改写已经提交、审核通过或冻结的赛事名单。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看我的队伍" })).toHaveAttribute("href", "/my/teams");
    expect(screen.getByText(/参赛确认：已确认参赛/)).toBeInTheDocument();
  });

  it("renders sanctions and historical competitions", () => {
    const sanction = { id: "case-1", seasonId: "season-1", seasonName: "2026 秋季赛", seasonSlug: "fall-2026", effects: ["registration_block" as const, "roster_block" as const, "match_participation_block" as const], explanation: "公开说明", effectiveFrom: new Date("2026-08-01T00:00:00Z"), effectiveUntil: null };
    render(<MyReadinessDashboard model={{ ...model, sanctions: [sanction], readiness: { ...readiness, sanctions: [sanction] }, historyCompetitions: [{ ...context, entryId: "entry-history", season: { ...context.season, id: "season-history", name: "2025 秋季赛", status: "finished" }, primaryAction: { href: "/past", label: "赛事回顾" } }] }} />);
    expect(screen.getByText(/阻止报名、阻止进入赛事名单、阻止单场出场/)).toBeInTheDocument();
    expect(screen.getByText("历史赛事")).toBeInTheDocument();
    expect(screen.getByText("2025 秋季赛")).toBeInTheDocument();
  });
});
