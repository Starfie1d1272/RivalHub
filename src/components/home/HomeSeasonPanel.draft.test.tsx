import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSeasonPanel } from "./HomeSeasonPanel";
import type { PublicDraftData } from "@/lib/draft/data";

const props = {
  season: { name: "NJU Rivals", slug: "rivals", status: "drafting" as const, registrationMode: "solo" as const, kind: "rivals", positions: [], registrationOpensAt: null, registrationOpenedAt: null, registrationClosesAt: null },
  maxPerPosition: 0, positionCountMap: new Map<string, number>(), topCandidatesWithNames: [], liveAndUpcomingMatches: [], teamCount: 8, playerCount: 56,
};
const draft: PublicDraftData = {
  state: null, teams: [], snakeOrder: [], remainingPlayers: [], completedPicks: [], totalPicks: 0, maxPicks: 48,
};

describe("homepage public draft facts", () => {
  it("keeps a preview as a preview without inventing a turn or repeating the event title", () => {
    render(<HomeSeasonPanel {...props} draftData={draft} />);
    expect(screen.getByText("选秀预览")).toBeVisible();
    expect(screen.queryByText("当前轮次")).not.toBeInTheDocument();
    expect(screen.queryByText("NJU Rivals")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看选秀 →" })).toHaveAttribute("href", "/rivals/draft");
  });

  it("shows persisted pick progress and pause state", () => {
    const { container } = render(<HomeSeasonPanel {...props} draftData={{ ...draft, totalPicks: 8, state: { currentRound: 2, currentEntryId: null, roundDeadline: null, isActive: false } }} />);
    expect(screen.getByText("选秀已暂停")).toBeVisible();
    expect(screen.getByText("等待恢复")).toBeVisible();
    expect(container).toHaveTextContent("8 / 48 已选");
    expect(container).toHaveTextContent("2 / 6");
  });

  it("gives completion precedence over a stale active flag", () => {
    render(<HomeSeasonPanel {...props} draftData={{ ...draft, totalPicks: 48, state: { currentRound: 6, currentEntryId: null, roundDeadline: null, isActive: true } }} />);
    expect(screen.getByText("阵容已完成")).toBeVisible();
    expect(screen.queryByText("当前选择")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回顾选秀 →" })).toBeVisible();
  });
});
