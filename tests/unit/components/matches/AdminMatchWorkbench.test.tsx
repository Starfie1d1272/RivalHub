/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Match } from "@/db/schema";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/rivalhub", () => ({ Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, StatusPill: () => <span /> }));
vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }));
vi.mock("@/components/matches/AdminRosterDialog", () => ({ AdminRosterDialog: () => <div data-testid="roster-dialog">roster editor</div> }));
vi.mock("@/components/matches/VetoInputDialog", () => ({ VetoInputDialog: () => <div data-testid="veto-dialog">veto</div> }));
vi.mock("@/components/matches/ScoreInput", () => ({ ScoreInput: () => <div data-testid="score-input">score</div> }));
vi.mock("@/components/matches/MapByMapInput", () => ({ MapByMapInput: () => <div data-testid="map-input">maps</div> }));
vi.mock("@/components/matches/ScheduledAtInput", () => ({ ScheduledAtInput: () => <div data-testid="scheduled-input">schedule</div> }));
vi.mock("@/components/matches/ResultCorrectionPanel", () => ({ ResultCorrectionPanel: () => <div data-testid="result-correction">correction</div> }));
vi.mock("@/components/matches/StatsOCRPanel", () => ({ StatsOCRPanel: () => <div data-testid="ocr-panel">ocr</div> }));
vi.mock("@/components/matches/ForfeitButton", () => ({ ForfeitButton: () => <div data-testid="forfeit-button">forfeit</div> }));
vi.mock("@/components/matches/MapScoreCorrectInput", () => ({ MapScoreCorrectInput: () => <div data-testid="map-correction">map correction</div> }));
vi.mock("@/components/matches/DeleteMatchButton", () => ({ DeleteMatchButton: () => <div data-testid="delete-match">delete</div> }));
vi.mock("@/components/matches/CompletedAtInput", () => ({ CompletedAtInput: () => <div data-testid="completed-at">completed at</div> }));
vi.mock("@/components/matches/PreMatchOperatorChecklist", () => ({ PreMatchOperatorChecklist: () => <div data-testid="preflight">preflight</div> }));
vi.mock("@/components/matches/PostMatchRecordPanel", () => ({ PostMatchRecordPanel: () => <div data-testid="postmatch">postmatch</div> }));

import { AdminMatchWorkbench } from "@/components/matches/AdminMatchWorkbench";

function data(status: Match["status"]) {
  const match = {
    id: "match-1",
    seasonId: "season-1",
    entryAId: "entry-a",
    entryBId: "entry-b",
    stage: "swiss",
    round: 1,
    format: "bo1" as const,
    entryRound: null,
    scoreA: status === "finished" ? 1 : null,
    scoreB: status === "finished" ? 0 : null,
    status,
    isForfeit: false,
    bracketNodeId: null,
    ownership: "major_stage" as const,
    majorStageRunId: "run-1",
    managedKey: "swiss:1:1",
    scheduledAt: new Date("2026-09-05T02:00:00Z"),
    completionDeadline: null,
    completedAt: status === "finished" ? new Date("2026-09-05T04:00:00Z") : null,
    videoUrl: status === "finished" ? "https://video.example/match" : null,
    mvpWinnerUserId: null,
    createdAt: new Date("2026-09-05T00:00:00Z"),
    updatedAt: new Date("2026-09-05T00:00:00Z"),
  } satisfies Match;
  const roster = { rosterId: "roster-a", starters: ["a1", "a2", "a3", "a4", "a5"], substitutes: [], status: "confirmed" };
  return {
    season: { id: "season-1", slug: "major", name: "Major" },
    stageName: "Swiss",
    match,
    teamAName: "Alpha",
    teamBName: "Beta",
    mapPool: ["de_inferno"],
    teamAMembers: ["a1", "a2", "a3", "a4", "a5"].map((id) => ({ id, entryId: "entry-a", steamName: id, displayName: null, perfectName: null, primaryPosition: "rifler" })),
    teamBMembers: ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ id, entryId: "entry-b", steamName: id, displayName: null, perfectName: null, primaryPosition: "rifler" })),
    teamARoster: roster,
    teamBRoster: { ...roster, rosterId: "roster-b", starters: ["b1", "b2", "b3", "b4", "b5"] },
    teamAPreflight: { valid: true, blockers: [] },
    teamBPreflight: { valid: true, blockers: [] },
    completedMaps: status === "finished" ? [{ mapOrder: 1, mapName: "de_inferno", scoreA: 13, scoreB: 9, pickedByEntryId: null, teamAStartSide: "t" as const }] : [],
    pendingMaps: [],
    finishedMaps: status === "finished" ? [{ id: "map-1", mapName: "de_inferno", scoreA: 13, scoreB: 9 }] : [],
    postMatch: { commentators: [], seasonAdmins: [], submittedAt: null, submittedByUserId: null, videoUrl: null, completionLabel: "待整理", canSubmit: status === "finished" },
  };
}

describe("AdminMatchWorkbench", () => {
  beforeEach(() => vi.stubGlobal("React", React));

  it("keeps scheduled lineup, execution and danger actions on the workbench", () => {
    render(<AdminMatchWorkbench {...data("scheduled")} />);

    expect(screen.getByRole("heading", { name: "首发名单" })).toBeInTheDocument();
    expect(screen.getByTestId("roster-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("veto-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("forfeit-button")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "危险操作与恢复" })).toBeInTheDocument();
  });

  it("keeps finished roster visibility, post-match/OCR and recovery actions together", () => {
    render(<AdminMatchWorkbench {...data("finished")} />);

    expect(screen.getByText("首发：a1、a2、a3、a4、a5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "赛后资料与 OCR" })).toBeInTheDocument();
    expect(screen.getByTestId("ocr-panel")).toBeInTheDocument();
    expect(screen.getByTestId("result-correction")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "危险操作与结果恢复" })).toBeInTheDocument();
  });
});
