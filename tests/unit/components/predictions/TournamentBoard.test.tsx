import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TournamentBoard } from "@/components/predictions/TournamentBoard";
import type { SimStage } from "@/lib/predictions/types";

const teams = ["Alpha", "Bravo"].map((name, i) => ({
  teamId: name,
  name,
  logoUrl: null,
  tournamentSeed: i + 1,
}));
const stage: SimStage = {
  key: "swiss",
  entrants: [],
  officialEntrants: true,
  complete: false,
  pick: null,
  standings: [{ teamId: "Alpha", wins: 3, losses: 0 }],
  matches: [
    {
      key: "r1",
      round: 1,
      a: "Alpha",
      b: "Bravo",
      winner: "Alpha",
      source: "preview",
      scoreA: null,
      scoreB: null,
      record: { wins: 0, losses: 0 },
      format: "bo1",
    },
  ],
};
describe("tournament presentation", () => {
  it("links each persisted match once in every layout without choosing a winner", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    const persisted = { ...stage, matches: [{ ...stage.matches[0]!, officialMatchId: "match-1" }] };
    render(<TournamentBoard stage={persisted} seasonSlug="major" teams={teams} editable onChoose={choose} />);
    for (const layout of ["紧凑对阵", "轮次列表", "晋级路径"]) {
      await user.click(screen.getByRole("button", { name: layout }));
      const card = screen.getByTestId("sim-match-swiss-r1");
      const links = within(card).getAllByRole("link");
      expect(links).toHaveLength(1);
      const link = within(card).getByRole("link", { name: "查看 Alpha 对 Bravo 比赛" });
      expect(link).toHaveAttribute("href", "/major/matches/match-1");
      link.addEventListener("click", event => event.preventDefault());
      await user.click(link);
      expect(choose).not.toHaveBeenCalled();
      await user.click(within(card).getByRole("button", { name: "Bravo 获胜" }));
      expect(choose).toHaveBeenCalledExactlyOnceWith(persisted.matches[0], "Bravo");
      choose.mockClear();
    }
  });
  it("disables server-rendered choices until hydration attaches their handlers", async () => {
    const choose = vi.fn();
    const board = <TournamentBoard stage={stage} teams={teams} editable onChoose={choose} />;
    const container = document.createElement("div");
    container.innerHTML = renderToString(board);
    const buttons = container.querySelectorAll('[data-testid="sim-match-swiss-r1"] button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();

    render(board, { container, hydrate: true });
    const choice = within(container).getByRole("button", { name: "Bravo 获胜" });
    expect(choice).toBeEnabled();
    await userEvent.setup().click(choice);
    expect(choose).toHaveBeenCalledExactlyOnceWith(stage.matches[0], "Bravo");
  });
  it("preserves choices across all layouts without treating preview winners as a selection", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(
      <TournamentBoard
        stage={stage}
        teams={teams}
        editable
        onChoose={choose}
      />,
    );
    for (const layout of ["紧凑对阵", "轮次列表", "晋级路径"]) {
      await user.click(screen.getByRole("button", { name: layout }));
      expect(
        screen.getByRole("button", { name: "Alpha 获胜 · 系统预览晋级" }),
      ).toHaveAttribute("aria-pressed", "false");
      await user.click(screen.getByRole("button", { name: "Bravo 获胜" }));
      expect(choose).toHaveBeenLastCalledWith(stage.matches[0], "Bravo");
      expect(screen.getByTestId("sim-match-swiss-r1")).toHaveAttribute(
        "data-source",
        "preview",
      );
      expect(within(screen.getByTestId("sim-match-swiss-r1")).queryByRole("link")).toBeNull();
    }
    expect(choose).toHaveBeenCalledTimes(3);
  });
  it("presents Short Swiss exits and deciding rounds with its own thresholds", async () => {
    render(
      <TournamentBoard
        stage={{
          ...stage,
          swissPolicy: { winThreshold: 2, lossThreshold: 2 },
          standings: [{ teamId: "Alpha", wins: 2, losses: 0 }],
          matches: stage.matches.map((m) => ({
            ...m,
            round: 3,
            record: { wins: 1, losses: 1 },
          })),
        }}
        teams={teams}
        editable
        onChoose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("record-3-1–1")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "紧凑对阵" }));
    const results = within(screen.getByRole("region", { name: "最终结果" }));
    expect(results.getByText("2–0")).toBeVisible();
    expect(screen.queryByText("3–0")).not.toBeInTheDocument();
    expect(results.getAllByText("Qualified")).toHaveLength(2);
    expect(results.getAllByText("Eliminated")).toHaveLength(2);
  });
});
