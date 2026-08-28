/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreMatchOperatorChecklist } from "@/components/matches/PreMatchOperatorChecklist";

const team = { name: "Alpha", submitted: true, confirmed: true, starters: 5, preflight: null };

describe("PreMatchOperatorChecklist", () => {
  it("does not turn a non-Major match's absent preflight into a blocker", () => {
    render(<PreMatchOperatorChecklist teamA={team} teamB={{ ...team, name: "Beta" }} mapState="not_required" />);

    expect(screen.getByText("可以开始比赛")).toBeInTheDocument();
    expect(screen.getAllByText(/按常规赛务流程进行/)).toHaveLength(2);
  });

  it("shows absent Major preflight as a server-check blocker", () => {
    render(<PreMatchOperatorChecklist requiresPreflight teamA={team} teamB={{ ...team, name: "Beta" }} mapState="not_required" />);

    expect(screen.getByText("当前不可开赛")).toBeInTheDocument();
    expect(screen.getByText(/Alpha 尚未完成首发资格检查/)).toBeInTheDocument();
    expect(screen.getByText(/Beta 尚未完成首发资格检查/)).toBeInTheDocument();
  });
});
