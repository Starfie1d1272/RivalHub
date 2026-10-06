/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MajorTournamentSeedsManagement, type MajorTournamentSeedsManagementData } from "@/components/admin/MajorTournamentSeedsManagement";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";

Object.assign(globalThis, { React });
vi.mock("@/actions/major-prestart", () => ({ confirmMajorTournamentSeeds: vi.fn(), saveMajorTournamentSeeds: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fact = { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null };
const member = { userId: "player-1", label: "Player One", isPrimaryStarter: true, presentation: {
  historicalPeak: fact, referenceSeasonPeak: fact, currentSeasonPeak: fact, recentPeak: fact,
  historicalRating: 1000, available: true, blockers: [],
} };
const management = {
  rankingRoster: [{ entryId: "team-1", members: [member] }],
  strengthPreview: { platform: "perfect_world" },
  qualification: { run: { entrants: [{ entryId: "team-1", preliminarySeed: 4, route: "play-in", wins: 2, losses: 0 }] } },
} as unknown as MajorPrestartPageData["management"];
const data: MajorTournamentSeedsManagementData = {
  seasonId: "season-1", entrantCapacity: 1, firstSwissStageName: "阶段一",
  entryCohorts: [{ stageKey: "stage1", stageName: "阶段一", fromSeed: 1, toSeed: 1 }],
  entrantsLocked: true, entrants: [{ teamId: "team-1", teamName: "Team One" }],
  seeds: [], seedsConfirmed: false, recommendationStatus: "ready",
  recommendation: { version: 1, generatedAt: "2026-09-13T00:00:00Z", platform: "perfect_world", conversionPolicyId: null, conversionPolicyVersion: null,
    teams: [{ entrantId: "entrant-1", teamId: "team-1", teamName: "Team One", available: true, blockers: [], recommendationRank: 1, displayOrder: 1, tieState: "not_tied", starters: [member], finalSeed: null, finalOrderStatus: "unsaved" }] },
  firstRound: null,
};

describe("Major final seed workspace", () => {
  it("shows system, preliminary and Qualification context beside the complete roster", () => {
    render(<MajorTournamentSeedsManagement data={data} management={management} />);
    expect(screen.getByRole("row", { name: /Team One/ })).toHaveTextContent("原 #4");
    expect(screen.getByRole("row", { name: /Team One/ })).toHaveTextContent("Play-in 晋级 · 2-0");
    expect(screen.getByRole("button", { name: /Player One，主力/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存排序" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "确认最终种子" })).toBeDisabled();
    expect(screen.queryByText(/weightedRank|teamSeedStrength/)).not.toBeInTheDocument();
  });
  it("draws cohort boundaries from the managed profile", () => {
    const entrants = Array.from({ length: 24 }, (_, index) => ({ teamId: `team-${index + 1}`, teamName: `Team ${index + 1}` }));
    render(<MajorTournamentSeedsManagement data={{ ...data, entrantCapacity: 24, entrants, seeds: [], recommendationStatus: "missing", recommendation: null,
      entryCohorts: [{ stageKey: "stage2", stageName: "阶段二", fromSeed: 1, toSeed: 8 }, { stageKey: "stage1", stageName: "阶段一", fromSeed: 9, toSeed: 24 }] }} management={management} />);
    expect(screen.getByText("进入 阶段二 / 下一批次")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(25);
  });
});
