/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MajorCompetitionFlow } from "@/components/admin/MajorCompetitionFlow";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";

Object.assign(globalThis, { React });
const saveOrder = vi.hoisted(() => vi.fn(async () => ({ success: true, data: undefined })));
vi.mock("@/actions/competition-qualification", () => ({
  configureCompetitionQualification: vi.fn(), generateCompetitionQualificationRound: vi.fn(),
  previewCompetitionQualificationRound: vi.fn(), resetCompetitionQualification: vi.fn(),
  saveCompetitionQualificationOrder: saveOrder,
}));
vi.mock("@/actions/major-prestart", () => ({ selectMajorEntrants: vi.fn(), setMajorManagedProfile: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const data = {
  seasonId: "season-1", seasonSlug: "major", seasonStatus: "registration", managedProfileId: "major-24",
  registrationClosed: true, entrantCapacity: 24, entrantsLocked: false, approvedCandidateCount: 3, pendingReviewCount: 0,
  initialPreliminaryOrderEntryIds: ["A", "C", "B"], approvedCandidates: [], entrants: [], rankingRoster: [],
  strengthPreview: { status: "ready", platform: "perfect_world", teams: [
    { teamId: "A", recommendationRank: 1 }, { teamId: "B", recommendationRank: 3 }, { teamId: "C", recommendationRank: 2 },
  ] },
  qualification: { run: { id: "run-1", format: "direct_bo3", directEntryCount: 1, playInEntryCount: 2, qualifierCount: 1,
    targetEntrantCount: 24, candidateCount: 3, startedAt: null, completedAt: null,
    entrants: [
      { entryId: "A", teamName: "A", preliminarySeed: 1, route: "direct", wins: 0, losses: 0, status: "not_started" },
      { entryId: "B", teamName: "B", preliminarySeed: 2, route: "play-in", wins: 0, losses: 0, status: "not_started" },
      { entryId: "C", teamName: "C", preliminarySeed: 3, route: "play-in", wins: 0, losses: 0, status: "not_started" },
    ], currentRound: 0, matchCount: 0, finishedMatchCount: 0 } },
} as unknown as MajorPrestartPageData["management"];

describe("configured Qualification ranking", () => {
  it("edits the persisted #2 rank rather than the stale system order and saves one batch", async () => {
    const user = userEvent.setup();
    render(<MajorCompetitionFlow data={data} phase="runtime" />);
    expect(screen.getByText("B").closest("tr")).toHaveTextContent("#2");
    await user.click(screen.getByRole("button", { name: "将B下移" }));
    expect(screen.getByText("B").closest("tr")).toHaveTextContent("#3");
    await user.click(screen.getByRole("button", { name: "保存排序" }));
    await waitFor(() => expect(saveOrder).toHaveBeenCalledWith({ seasonId: "season-1", runId: "run-1", orderedCompetitionEntryIds: ["A", "C", "B"] }));
    expect(saveOrder).toHaveBeenCalledTimes(1);
  });
});
