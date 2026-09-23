/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MajorStartManagement } from "@/components/admin/MajorStartManagement";
import type { MajorOpeningPlan } from "@/lib/major/opening";

Object.assign(globalThis, { React });

vi.mock("@/actions/major-prestart", () => ({
  startMajor: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const preview: MajorOpeningPlan = {
  profile: { id: "major-32", entrantCapacity: 32 },
  tournamentTeams: [],
  entryCohorts: [],
  stage1: { key: "stage1", name: "阶段一", entrants: [] },
  firstRound: {
    pairings: [{
      round: 1,
      higherSeed: { teamId: "team-a", tournamentSeed: 17, stageSeed: 1 },
      lowerSeed: { teamId: "team-b", tournamentSeed: 32, stageSeed: 16 },
      format: "bo1",
      pairingRule: "initial",
    }],
  },
};

describe("MajorStartManagement", () => {
  it("does not treat a preview opening plan as start authorization", () => {
    render(
      <MajorStartManagement
        seasonId="season-1"
        openingPlan={preview}
        canStart={false}
        started={false}
      />,
    );

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "正式开始 Major" })).toBeDisabled();
    expect(screen.getByText(/创建 1 场 阶段一 首轮比赛/)).toBeInTheDocument();
    expect(screen.queryByText(/#1 vs #32/)).not.toBeInTheDocument();
  });

  it("shows the selected capacity and seed cohorts for Major-24", () => {
    const major24: MajorOpeningPlan = {
      profile: { id: "major-24", entrantCapacity: 24 },
      tournamentTeams: [],
      entryCohorts: [
        { stageKey: "stage2", stageName: "阶段二", fromSeed: 1, toSeed: 8, entrants: [] },
        { stageKey: "stage1", stageName: "阶段一", fromSeed: 9, toSeed: 24, entrants: [] },
      ],
      stage1: { key: "stage1", name: "阶段一", entrants: [] },
      firstRound: { pairings: [] },
    };
    render(<MajorStartManagement seasonId="season-24" openingPlan={major24} canStart={true} started={false} />);

    expect(screen.getByText(/正式 24 队/)).toBeInTheDocument();
    expect(screen.getByText(/#1–8 → 阶段二、#9–24 → 阶段一/)).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "正式开始 Major" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(start).toBeEnabled();
  });
});
