/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeamWorkspace, type TeamPerformanceDetail } from "./TeamWorkspace";

const emptyDetail = {
  teamId: "entry-1",
  analytics: null,
  performance: null,
  selection: [],
  maps: [],
  economyMatrix: [],
  detailedPlayers: [],
  scoreboard: [],
} as unknown as TeamPerformanceDetail;

describe("TeamWorkspace copy", () => {
  it("keeps analytics tabs free of permanent implementation explanations", () => {
    render(<TeamWorkspace detail={emptyDetail} />);

    fireEvent.click(screen.getByRole("tab", { name: "Rounds & Economy" }));
    expect(screen.queryByText("按实际回合经济组合聚合；空样本不按 0 处理。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Maps" }));
    expect(screen.getByRole("heading", { name: "正式地图表现" })).toBeInTheDocument();
    expect(screen.queryByText(/Pick\/Ban 仅来自正式 BP 记录/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.queryByText("仅统计实际代表该队伍出场并进入当前可信数据集的选手。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Weapons" }));
    expect(screen.queryByText("按队伍当前可信回合样本聚合武器击杀。")).not.toBeInTheDocument();
  });
});
