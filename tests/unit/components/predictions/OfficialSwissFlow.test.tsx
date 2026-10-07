import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StageSwissReadModel } from "@/components/matches/StageSwissReadModel";
import type { SwissStageReadModel } from "@/lib/matches/stage-read-model";
function fixture(stageKey = "play-in"): SwissStageReadModel {
  return { stageKey, stageName: "Swiss", teamCount: 12, advanceCount: 6, finalizedRound: 0, seedPrefix: "P",
    competitionEntries: Array.from({ length: 12 }, (_, i) => ({ entryId: `e${i}`, teamName: `Team ${i}`, seed: i+1, wins: 0, losses: 0, difficultyScore: 0, status: "active" })),
    rounds: Array.from({ length: stageKey === "play-in" ? 3 : 5 }, (_, i) => ({ round: i+1, status: i === 0 ? "active" : "upcoming", groups: i ? [] : [{record: "0:0", matchups: Array.from({length: 6}, (_, j) => ({matchId: `m${j}`, entryAId: `e${j}`, entryBId: `e${j+6}`, teamAName: `Team ${j}`, teamBName: `Team ${j+6}`, scoreA: null, scoreB: null, status: "scheduled", format: "bo1", round: 1}))}] })) };
}
describe("official Swiss adapter", () => {
  it("shows all six persisted matches and future record paths without inventing opponents, links or results", async () => {
    render(<StageSwissReadModel data={fixture()} seasonSlug="event" />);
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("link", {name: "Team 5 对 Team 11"})).toHaveAttribute("href", "/event/matches/m5");
    expect(screen.getByTestId("record-2-1–0")).toHaveTextContent("待定");
    expect(screen.getByTestId("record-2-0–1")).toHaveTextContent("待定");
    expect(screen.getByTestId("record-3-1–1")).toHaveTextContent("待定");
    expect(screen.queryByText("暂无对阵")).not.toBeInTheDocument();
    const results = within(screen.getByRole("region", {name: "最终结果"}));
    for (const record of ["2–0", "2–1", "0–2", "1–2"]) expect(results.getByText(record)).toBeVisible();
    expect(results.queryByText("Team 0")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", {name: "轮次列表"}));
    await userEvent.setup().click(screen.getByRole("button", {name: "展示第 3 轮"}));
    expect(screen.getByRole("button", {name: "展示第 3 轮"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("link")).toHaveLength(6);
  });
  it.each(["stage1", "stage2"])("uses canonical 3W3L exits and official outcomes for %s", stageKey => {
    const data = fixture(stageKey); data.competitionEntries[0] = {...data.competitionEntries[0]!, wins: 3, status: "advanced"};
    render(<StageSwissReadModel data={data} seasonSlug="event" />);
    const results = within(screen.getByRole("region", {name: "最终结果"}));
    for (const record of ["3–0", "3–1", "3–2", "0–3", "1–3", "2–3"]) expect(results.getByText(record)).toBeVisible();
    expect(results.getByText("Team 0")).toBeVisible();
    expect(results.queryByText("Team 1")).not.toBeInTheDocument();
  });
});
