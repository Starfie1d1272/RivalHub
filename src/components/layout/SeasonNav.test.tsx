/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SeasonNav } from "./SeasonNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/spring/teams",
}));

describe("SeasonNav", () => {
  it("keeps workflow links first and groups teams with players", () => {
    render(
      <SeasonNav
        slug="spring"
        status="registration"
        hasCaptainVoting
        hasDraft
        hasMatches
        hasStats
      />,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "首页",
      "报名",
      "队长投票",
      "选秀",
      "队伍",
      "选手",
      "赛程",
      "社区奖",
      "数据统计",
    ]);
  });

  it("turns the season navigation into a historical view when finished", () => {
    render(
      <SeasonNav
        slug="finished"
        status="finished"
        hasCaptainVoting
        hasDraft
        hasMatches
        hasStats
      />,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "首页",
      "队长投票结果",
      "选秀回顾",
      "队伍",
      "选手",
      "赛程",
      "社区奖",
      "数据统计",
    ]);
  });
});
