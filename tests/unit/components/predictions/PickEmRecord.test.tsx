import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PickEmRecord } from "@/components/predictions/PickEmRecord";
import type { PredictionBoardData } from "@/lib/predictions/data";
const data = { base: { stages: [], teams: [] } } as unknown as PredictionBoardData;
describe("Pick’Em record", () => {
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
    render(<PickEmRecord data={recordData} />);
    expect(screen.getByText("1 / 8 项挑战")).toBeVisible();
    expect(screen.queryByText(/积分榜|积分流水/)).not.toBeInTheDocument();
  });

});
