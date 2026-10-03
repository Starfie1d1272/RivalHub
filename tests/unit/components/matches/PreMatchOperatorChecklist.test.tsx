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
    render(<PreMatchOperatorChecklist teamA={team} teamB={{ ...team, name: "Beta" }} mapState="not_recorded" />);

    expect(screen.getByText("首发已准备好")).toBeInTheDocument();
    expect(screen.getByText("双方进入 BP，确认准备后开始禁选。")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows absent Major preflight as a server-check blocker", () => {
    render(<PreMatchOperatorChecklist requiresPreflight teamA={team} teamB={{ ...team, name: "Beta" }} mapState="not_recorded" />);

    expect(screen.getByText("首发待处理")).toBeInTheDocument();
    expect(screen.getByText(/Alpha：请完成首发资格检查/)).toBeInTheDocument();
    expect(screen.getByText(/Beta：请完成首发资格检查/)).toBeInTheDocument();
  });
});
