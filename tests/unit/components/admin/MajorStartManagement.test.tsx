/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
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
  tournamentTeams: [],
  stage1: { entrants: [] },
  stage2: { directEntrants: [] },
  stage3: { directEntrants: [] },
  firstRound: {
    pairings: [{
      round: 1,
      higherSeed: { teamId: "team-a", tournamentSeed: 1, stageOneSeed: 1 },
      lowerSeed: { teamId: "team-b", tournamentSeed: 32, stageOneSeed: 16 },
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
  });
});
