import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TournamentBoard } from "@/components/predictions/TournamentBoard";
import type { SimStage } from "@/lib/predictions/types";

const teams = ["Alpha", "Bravo"].map((name, i) => ({ teamId: name, name, logoUrl: null, tournamentSeed: i + 1 }));
const stage: SimStage = {
  key: "swiss", entrants: [], officialEntrants: true, complete: false, pick: null,
  standings: [{ teamId: "Alpha", wins: 3, losses: 0 }],
  matches: [{ key: "r1", round: 1, a: "Alpha", b: "Bravo", winner: "Alpha", source: "preview", scoreA: null, scoreB: null, record: { wins: 0, losses: 0 }, format: "bo1" }],
};
describe("tournament presentation", () => {
  it("preserves choices across all layouts without treating preview winners as a selection", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(<TournamentBoard stage={stage} teams={teams} editable onChoose={choose} />);
    for (const layout of ["紧凑对阵", "轮次列表", "晋级路径"]) {
      await user.click(screen.getByRole("button", { name: layout }));
      expect(screen.getByRole("button", { name: "Alpha 获胜 · 系统预览晋级" })).toHaveAttribute("aria-pressed", "false");
      await user.click(screen.getByRole("button", { name: "Bravo 获胜" }));
      expect(choose).toHaveBeenLastCalledWith(stage.matches[0], "Bravo");
      expect(screen.getByTestId("sim-match-swiss-r1")).toHaveAttribute("data-source", "preview");
    }
    expect(choose).toHaveBeenCalledTimes(3);
  });
  it("keeps incompatible snapshots read-only", () => {
    render(<TournamentBoard stage={stage} teams={teams} editable={false} onChoose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Alpha 获胜 · 系统预览晋级" })).toBeDisabled();
  });
});
