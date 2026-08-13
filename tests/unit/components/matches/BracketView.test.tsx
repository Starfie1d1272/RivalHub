/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BracketData } from "@/lib/bracket";

const push = vi.fn();
const renderBracket = vi.fn(async () => {
  const root = document.querySelector("#bracket-container");
  const match = document.createElement("div");
  match.setAttribute("data-match-id", "7");
  match.textContent = "Match 7";
  root?.append(match);
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next/script", () => ({
  default: function ScriptMock({ onReady }: { onReady?: () => void; src: string }) {
    useEffect(() => {
      onReady?.();
    }, [onReady]);
    return null;
  },
}));

const bracketData: BracketData = {
  stage: [{ id: 1, name: "Playoff", type: "single_elimination", settings: {} }],
  match: [
    {
      id: 7,
      stage_id: 1,
      group_id: 0,
      round_id: 3,
      number: 1,
      status: 2,
      child_count: 0,
      opponent1: { id: 0 },
      opponent2: { id: 1 },
    },
  ],
  participant: [
    { id: 0, name: "Team 1" },
    { id: 1, name: "Team 2" },
  ],
  match_game: [],
  group: [{ id: 0, stage_id: 1, number: 1 }],
  round: [{ id: 3, stage_id: 1, group_id: 0, number: 1 }],
};

describe("BracketView", () => {
  beforeEach(() => {
    push.mockClear();
    renderBracket.mockClear();
    window.React = React;
    window.bracketsViewer = { render: renderBracket };
  });

  it("renders the root required by brackets-viewer and passes raw bracket data", async () => {
    const { BracketView } = await import("@/components/matches/BracketView");

    render(<BracketView data={bracketData} />);

    expect(document.querySelector("#bracket-container")).toHaveClass("brackets-viewer");

    await waitFor(() => expect(renderBracket).toHaveBeenCalledTimes(1));
    expect(renderBracket).toHaveBeenCalledWith(
      {
        stages: bracketData.stage,
        matches: bracketData.match,
        participants: bracketData.participant,
        matchGames: bracketData.match_game,
      },
      { selector: "#bracket-container", clear: true },
    );
  });

  it("binds bracket match clicks using brackets-viewer data-match-id nodes", async () => {
    const { BracketView } = await import("@/components/matches/BracketView");

    render(
      <BracketView
        data={bracketData}
        matchNodeMap={new Map([["7", "match-uuid"]])}
        seasonSlug="spring-2026"
      />,
    );

    const matchNode = await screen.findByText("Match 7");
    fireEvent.click(matchNode);

    expect(push).toHaveBeenCalledWith("/spring-2026/matches/match-uuid");
  });

  it("overrides brackets-viewer theme variables for Tactical Grid", async () => {
    const { BracketView } = await import("@/components/matches/BracketView");

    render(<BracketView data={bracketData} themeColor="#ff6b1a" />);

    const container = document.querySelector("#bracket-container") as HTMLElement;

    expect(container.style.getPropertyValue("--primary-background")).toBe("var(--color-bg)");
    expect(container.style.getPropertyValue("--secondary-background")).toBe("var(--color-panel)");
    expect(container.style.getPropertyValue("--match-background")).toBe("var(--color-panel-hi)");
    expect(container.style.getPropertyValue("--font-color")).toBe("var(--color-fg)");
    expect(container.style.getPropertyValue("--connector-color")).toBe("var(--color-border-hi)");
    expect(container.style.getPropertyValue("--border-selected-color")).toBe("#ff6b1a");
  });
});
