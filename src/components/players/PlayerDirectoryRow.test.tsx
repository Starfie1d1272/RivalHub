/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerDirectoryRow } from "./PlayerDirectoryRow";

const player = {
  userId: "player-1",
  registrationId: "registration-1",
  displayName: "Star Entry",
  primaryPosition: "opener",
  secondaryPosition: "closer",
  peakRank: "S",
  peakRating: 1.42,
  currentRank: "A+",
  currentRating: 1.18,
  teamName: "Rival Orange",
  stats: null,
};

describe("PlayerDirectoryRow", () => {
  it("prioritizes season competition stats when they exist", () => {
    render(
      <PlayerDirectoryRow
        player={{
          ...player,
          stats: { maps: 8, avgRating: 1.21, avgAdr: 82.4, avgKd: 1.36 },
        }}
      />,
    );

    expect(screen.getByText("地图")).toBeInTheDocument();
    expect(screen.getByText("副位置 Closer")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("1.21")).toBeInTheDocument();
    expect(screen.getByText("82.4")).toBeInTheDocument();
    expect(screen.getByText("1.36")).toBeInTheDocument();
  });

  it("keeps registration context when verified stats are missing", () => {
    render(<PlayerDirectoryRow player={player} />);

    expect(screen.getByText("暂无已验证数据")).toBeInTheDocument();
    expect(screen.getByText("峰值段位")).toBeInTheDocument();
    expect(screen.getAllByText("S")).toHaveLength(2);
    expect(screen.getByText("峰值 Rating")).toBeInTheDocument();
    expect(screen.getByText("1.42")).toBeInTheDocument();
    expect(screen.getByText("当前段位")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();
  });
});
