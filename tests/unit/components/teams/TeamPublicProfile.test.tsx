/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const longLivedTeam: PublicTeamProfile = {
  team: { id: "team-1", slug: "rival-team", name: "Rival Team", logoUrl: null, description: "队伍简介", status: "active", captainUserId: "captain-1" },
  currentMembers: [{ id: "member-1", userId: "captain-1", name: "队长甲", status: "active" }, { id: "member-2", userId: "member-1", name: "选手乙", status: "benched" }],
  entries: [{ id: "entry-1", name: "Rival Entry", status: "approved", seasonName: "2026 秋季赛", seasonSlug: "autumn-2026", seasonStatus: "finished", createdAt: new Date("2026-08-01T00:00:00Z") }],
  nameChanges: [{ id: "name-1", oldName: "Old Team", newName: "Rival Team", changedAt: new Date("2026-08-01T00:00:00Z") }],
  captainChanges: [{ id: "captain-1", name: "队长甲", changedAt: new Date("2026-08-01T00:00:00Z") }],
  playedCount: 4,
  wins: 3,
  currentUserMembership: { userId: "captain-1", status: "active" },
  recruitment: { id: "intent-1", positions: ["awper"], targetSeasonId: null, targetSeasonName: null, note: "缺一名主狙", expiresAt: new Date("2026-09-30T00:00:00Z"), updatedAt: new Date("2026-09-01T00:00:00Z") },
  viewerInterested: false,
  loggedIn: true,
};

const linkedEvent: PublicEventTeamContext = {
  season: { id: "season-1", slug: "autumn-2026", name: "2026 秋季赛", status: "playing" },
  entry: { id: "entry-1", name: "Frozen Entry", logoUrl: null, registrationStatus: "approved", representativeUserId: "captain-1", teamId: "team-1" },
  cardLabel: "已通过报名审核",
  participation: { label: "已通过", tone: "success", detail: "报名已通过审核。" },
  roster: [{ userId: "captain-1", name: "赛事队长", isStarter: true, isRepresentative: true }, { userId: "event-only-player", name: "赛事选手", isStarter: false, isRepresentative: false }],
  rosterLabel: "本届参赛名单",
  rosterStatus: "frozen",
  seed: null,
  seedPresentation: null,
  record: { played: 2, wins: 1, losses: 1, winRate: "50%" },
  matches: [{ id: "match-1", opponentId: "entry-2", opponentName: "Opponent", status: "finished", isForfeit: false, scheduledAt: new Date("2026-08-10T00:00:00Z"), completedAt: new Date("2026-08-10T01:00:00Z"), ownScore: 1, opponentScore: 0 }],
};

const eventNative: PublicEventTeamContext = {
  ...linkedEvent,
  entry: { ...linkedEvent.entry, id: "entry-native", name: "Event Native Entry", teamId: null, representativeUserId: "event-only-player" },
  roster: [{ userId: "event-only-player", name: "赛事选手", isStarter: true, isRepresentative: true }],
};

describe("TeamPublicProfile", () => {
  it("keeps the complete long-lived Team profile when no event context exists", () => {
    render(<TeamPublicProfile team={longLivedTeam} />);

    expect(screen.getByText("活跃")).toBeInTheDocument();
    expect(screen.getByText("招募中")).toBeInTheDocument();
    expect(screen.getByText("我的队伍 · 队长")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "管理我的队伍" })).toHaveAttribute("href", "/my/teams");
    expect(screen.queryByRole("button", { name: "表达加入意向" })).not.toBeInTheDocument();
    expect(screen.getAllByText("当前成员").length).toBeGreaterThan(0);
    expect(screen.getByText("赛事记录")).toBeInTheDocument();
    expect(screen.getByText("完赛")).toBeInTheDocument();
    expect(screen.getByText("Rival Entry")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2026 秋季赛/ })).toHaveAttribute("href", "/autumn-2026/teams/entry-1");
    expect(screen.getByText("队伍历史")).toBeInTheDocument();
    expect(screen.getByText("名称变更")).toBeInTheDocument();
    expect(screen.getByText("队长变更")).toBeInTheDocument();
  });

  it("composes a linked event snapshot with long-lived Team facts without mixing them", () => {
    render(<TeamPublicProfile team={longLivedTeam} event={linkedEvent} />);

    expect(screen.getByRole("heading", { name: /Frozen Entry/ })).toBeInTheDocument();
    expect(screen.getByText("Rival Team")).toBeInTheDocument();
    expect(screen.getByText("本届参赛名单")).toBeInTheDocument();
    expect(screen.getAllByText("名单已冻结")).not.toHaveLength(0);
    expect(screen.getByText("赛事队长")).toBeInTheDocument();
    expect(screen.getByText("赛事选手")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "长期队伍资料" })).toHaveAttribute("href", "/teams/rival-team");
    expect(screen.getByRole("link", { name: "返回赛事队伍" })).toHaveAttribute("href", "/autumn-2026/teams");
    expect(screen.getByRole("link", { name: "查看完整长期资料" })).toHaveAttribute("href", "/teams/rival-team");
    expect(screen.getAllByText("本届比赛")).not.toHaveLength(0);
    expect(screen.getByText("对阵 Opponent")).toBeInTheDocument();
  });

  it("uses the same shell for event-native entries and omits absent long-lived sections", () => {
    render(<TeamPublicProfile team={null} event={eventNative} />);

    expect(screen.getByRole("heading", { name: /Event Native Entry/ })).toBeInTheDocument();
    expect(screen.getByText("本届参赛名单")).toBeInTheDocument();
    expect(screen.getByText("赛事选手")).toBeInTheDocument();
    expect(screen.queryByText("长期队伍资料")).not.toBeInTheDocument();
    expect(screen.queryByText("当前成员")).not.toBeInTheDocument();
    expect(screen.queryByText("队伍历史")).not.toBeInTheDocument();
  });
});
