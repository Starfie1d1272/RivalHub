/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MajorCompetitionFlow } from "@/components/admin/MajorCompetitionFlow";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";

Object.assign(globalThis, { React });
const saveDraft = vi.hoisted(() => vi.fn());
const configure = vi.hoisted(() => vi.fn(async () => ({ success: true, data: undefined })));
const saveOrder = vi.hoisted(() => vi.fn(async () => ({ success: true, data: undefined })));
vi.mock("@/actions/competition-qualification", () => ({
  configureCompetitionQualification: configure, generateCompetitionQualificationRound: vi.fn(),
  previewCompetitionQualificationRound: vi.fn(), resetCompetitionQualification: vi.fn(),
  saveCompetitionQualificationOrder: saveOrder, saveCompetitionQualificationDraft: saveDraft,
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
  it("keeps the configured order locked before round one", () => {
    render(<MajorCompetitionFlow data={data} phase="runtime" />);
    expect(screen.getByText("B").closest("tr")).toHaveTextContent("#2");
    expect(screen.queryByRole("button", { name: "将B下移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存排序" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置配置" })).toBeEnabled();
    expect(saveOrder).not.toHaveBeenCalled();
  });
});

function draftData() {
  const ids = Array.from({ length: 26 }, (_, index) => `entry-${index}`);
  return { ...data, approvedCandidateCount: 26, initialPreliminaryOrderEntryIds: ids,
    approvedCandidates: ids.map(id => ({ id, name: id, roster: { members: [] } })),
    qualification: { run: null, draft: null },
  } as unknown as MajorPrestartPageData["management"];
}

describe("shared preliminary draft", () => {
  it("requires save, marks edits dirty and confirms the saved version", async () => {
    const user = userEvent.setup();
    const fresh = draftData();
    saveDraft.mockImplementation(async input => ({ success: true, data: { ...input, targetEntrantCount: 24, version: 1, updatedBy: "committee", updatedAt: "2026-10-06T08:00:00Z", stale: false } }));
    render(<MajorCompetitionFlow data={fresh} phase="plan" />);
    expect(screen.getByRole("button", { name: "预览 Play-in 配置" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("草稿 v1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "预览 Play-in 配置" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "将entry-0下移" }));
    expect(screen.getByRole("status")).toHaveTextContent("未保存修改");
    expect(screen.getByRole("button", { name: "预览 Play-in 配置" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "将entry-0上移" }));
    await user.click(screen.getByRole("button", { name: "预览 Play-in 配置" }));
    await user.click(screen.getByRole("button", { name: "确认并锁定配置" }));
    await waitFor(() => expect(configure).toHaveBeenCalledWith({ seasonId: fresh.seasonId, format: "direct_bo3", preliminaryOrderEntryIds: fresh.initialPreliminaryOrderEntryIds, expectedDraftVersion: 1 }));
  });
  it("does not restore missing candidates from a stale server draft", () => {
    const fresh = draftData();
    fresh.qualification.draft = { order: ["removed-entry"], format: "direct_bo3", targetEntrantCount: 24, version: 3, updatedBy: "committee", updatedAt: "2026-10-06T08:00:00Z", stale: true };
    render(<MajorCompetitionFlow data={fresh} phase="plan" />);
    expect(screen.getByRole("status")).toHaveTextContent("候选集合已变化");
    expect(screen.queryByText("removed-entry")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览 Play-in 配置" })).toBeDisabled();
  });
});
