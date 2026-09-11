/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MajorPlayerDirectoryRow } from "./MajorPlayerDirectoryRow";

describe("MajorPlayerDirectoryRow", () => {
  it("renders event facts and links the player back to the event team", () => {
    render(
      <MajorPlayerDirectoryRow
        seasonSlug="nju-major"
        player={{
          userId: "player-1",
          entryId: "entry-1",
          entryName: "Entry Alpha",
          name: "选手甲",
          isStarter: true,
          isRepresentative: true,
          stats: { maps: 8, avgRating: 1.21, avgAdr: 82.4, avgKd: 1.36 },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "选手甲" })).toHaveAttribute("href", "/players/player-1");
    expect(screen.getByRole("link", { name: "Entry Alpha" })).toHaveAttribute("href", "/nju-major/teams/entry-1");
    expect(screen.getByText("首发")).toBeInTheDocument();
    expect(screen.queryByText("队伍代表")).not.toBeInTheDocument();
    expect(screen.getByText("1.21")).toBeInTheDocument();
  });

  it("keeps missing stats unknown", () => {
    render(
      <MajorPlayerDirectoryRow
        seasonSlug="nju-major"
        player={{
          userId: "player-2",
          entryId: "entry-2",
          entryName: "Entry Beta",
          name: "选手乙",
          isStarter: false,
          isRepresentative: false,
          stats: null,
        }}
      />,
    );

    expect(screen.getByText("替补")).toBeInTheDocument();
    expect(screen.getByText("暂无本届正式比赛数据")).toBeInTheDocument();
    expect(screen.queryByText("报名位置")).not.toBeInTheDocument();
  });
});
