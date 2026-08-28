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

    expect(screen.getByText("可以发起开赛复核")).toBeInTheDocument();
    expect(screen.getAllByText(/不需要额外的 Major 资格预检/)).toHaveLength(2);
  });

  it("shows absent Major preflight as a server-check blocker", () => {
    render(<PreMatchOperatorChecklist requiresPreflight teamA={team} teamB={{ ...team, name: "Beta" }} mapState="not_required" />);

    expect(screen.getByText("当前不可开赛")).toBeInTheDocument();
    expect(screen.getByText(/Alpha 尚未得到服务端预检结果/)).toBeInTheDocument();
    expect(screen.getByText(/Beta 尚未得到服务端预检结果/)).toBeInTheDocument();
  });
});
