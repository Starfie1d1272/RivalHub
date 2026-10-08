/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SeasonNav } from "./SeasonNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/spring/teams" }));
const capabilities = { hasCaptainVoting: true, hasDraft: true, hasCommunityAwards: true, hasMatches: true, hasStats: true };
const optionalLinks = ["队长投票", "选秀", "社区奖", "赛程", "数据统计"];

describe("SeasonNav", () => {
  it("exposes registration and enabled event capabilities", () => {
    render(<SeasonNav slug="spring" status="registration" {...capabilities} />);
    expect(screen.getByRole("link", { name: "报名" })).toHaveAttribute("href", "/spring/register");
    for (const [name, path] of [["队长投票", "captains"], ["选秀", "draft"], ["社区奖", "community-awards"], ["赛程", "matches"]]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/spring/${path}`);
    }
    expect(screen.getByRole("link", { name: "数据统计" })).toHaveAttribute("href", "/stats?event=spring");
  });

  it("hides registration in the historical view while retaining enabled capabilities", () => {
    render(<SeasonNav slug="finished" status="finished" {...capabilities} />);
    expect(screen.queryByRole("link", { name: "报名" })).not.toBeInTheDocument();
    for (const name of optionalLinks) expect(screen.getByRole("link", { name })).toBeInTheDocument();
  });

  it("hides disabled capabilities while retaining public roster navigation", () => {
    render(<SeasonNav slug="disabled" status="playing" hasCaptainVoting={false} hasDraft={false} hasCommunityAwards={false} hasMatches={false} hasStats={false} />);
    for (const name of optionalLinks) expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "队伍" })).toHaveAttribute("href", "/disabled/teams");
    expect(screen.getByRole("link", { name: "选手" })).toHaveAttribute("href", "/disabled/players");
  });
});
