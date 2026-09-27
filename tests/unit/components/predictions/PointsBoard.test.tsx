import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PointsBoard, PredictionRecord } from "@/components/predictions/PointsBoard";
import type { PredictionBoardData } from "@/lib/predictions/data";

const data = {
  base: { stages: [], teams: [] }, balance: "200", profit: "0", joined: true, paused: false,
  markets: [{
    id: "m", title: "系列赛胜者", stageKey: "s", deadline: "2030-01-01T00:00:00Z", locked: false,
    state: "pending", participants: 0, myStake: "0", myOptionId: null,
    options: ["Alpha", "Bravo", "Charlie"].map((label) => ({ id: label, label, pool: "0", entryId: null })),
  }],
} as unknown as PredictionBoardData;

describe("points workbench", () => {
  it("keeps multi-option choice and preset amount separate from explicit investment", async () => {
    const user = userEvent.setup();
    const stake = vi.fn();
    render(<PointsBoard data={data} busy={false} onStake={stake} />);
    await user.click(screen.getByRole("button", { name: /Charlie/ }));
    await user.click(screen.getByRole("button", { name: "100" }));
    expect(screen.getByLabelText("投入积分")).toHaveValue("100");
    expect(stake).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "250" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "确认投入" }));
    expect(stake).toHaveBeenCalledWith("m", "Charlie", "100");
    await user.click(screen.getByRole("button", { name: "我的投入" }));
    expect(screen.getByText("还没有投入记录。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "全部比赛" }));
    expect(screen.getByRole("button", { name: /Charlie/ })).toHaveAttribute("aria-pressed", "true");
  });
  it("shows closed pools through the all filter without offering stake controls", async () => {
    const user = userEvent.setup();
    render(<PointsBoard data={{ ...data, markets: data.markets.map((market) => ({ ...market, locked: true })) }} busy={false} onStake={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "系列赛胜者" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全部比赛" }));
    expect(screen.getByText("已关盘，等待官方确认本轮结果。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "确认投入" })).not.toBeInTheDocument();
  });
  it("uses the event challenge capacity instead of a fixed total", () => {
    const recordData = {
      ...data,
      base: {
        ...data.base,
        stages: [
          { key: "stage1", type: "swiss" },
          { key: "stage2", type: "swiss" },
          { key: "playoff", type: "single_elim" },
        ],
      },
      achievement: {
        coin: "青铜",
        challenges: 1,
        maximumCoin: "钻石",
        progress: [],
      },
      pointsLeaderboard: [],
      pickLeaderboard: [],
      ledger: [],
      rules: { silver: 4, gold: 6, diamond: 8, swissTarget: 5 },
    } as unknown as PredictionBoardData;
    render(<PredictionRecord data={recordData} />);
    expect(screen.getByText("1 / 8 项挑战")).toBeVisible();
  });

});
