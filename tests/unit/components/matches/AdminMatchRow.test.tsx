/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/utils/cn", () => ({ cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ") }));
vi.mock("@/lib/utils/date", () => ({ toCSTDateTimeInput: () => "" }));
vi.mock("@/types/match", () => ({ MATCH_FORMAT_LABELS: { bo1: "BO1", bo3: "BO3", bo5: "BO5" } }));
vi.mock("@/components/ui/separator", () => ({ Separator: () => null }));
vi.mock("@/components/rivalhub", () => ({ Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, StatusPill: () => null }));
vi.mock("@/components/matches/MatchStatusBadge", () => ({ MatchStatusBadge: () => null }));
vi.mock("@/components/matches/ScoreInput", () => ({ ScoreInput: () => null }));
vi.mock("@/components/matches/MapByMapInput", () => ({ MapByMapInput: () => null }));
vi.mock("@/components/matches/ScheduledAtInput", () => ({ ScheduledAtInput: () => null }));
vi.mock("@/components/matches/VetoInputDialog", () => ({ VetoInputDialog: () => null }));
vi.mock("@/components/matches/AdminRosterDialog", () => ({ AdminRosterDialog: () => null }));
vi.mock("@/components/matches/ResultCorrectionPanel", () => ({ ResultCorrectionPanel: () => null }));
vi.mock("@/components/matches/StatsOCRPanel", () => ({ StatsOCRPanel: () => null }));
vi.mock("@/components/matches/ForfeitButton", () => ({ ForfeitButton: () => null }));
vi.mock("@/components/matches/MapScoreCorrectInput", () => ({ MapScoreCorrectInput: () => null }));
vi.mock("@/components/matches/DeleteMatchButton", () => ({ DeleteMatchButton: () => null }));
vi.mock("@/components/matches/CompletedAtInput", () => ({ CompletedAtInput: () => null }));
vi.mock("@/components/matches/PreMatchOperatorChecklist", () => ({ PreMatchOperatorChecklist: () => null }));

import { AdminMatchRow, getAdminMatchStartBlockers } from "@/components/matches/AdminMatchRow";

const roster = { rosterId: "roster", starters: ["1", "2", "3", "4", "5"], substitutes: [], status: "confirmed" };

describe("AdminMatchRow start gate presentation", () => {
  it("blocks a Major start when the authoritative preflight is unavailable", () => {
    expect(getAdminMatchStartBlockers({
      requiresPreflight: true,
      teamAName: "Alpha",
      teamBName: "Beta",
      teamARoster: roster,
      teamBRoster: roster,
      teamAPreflight: null,
      teamBPreflight: null,
    })).toEqual([
      "Alpha 尚未得到服务端预检结果",
      "Beta 尚未得到服务端预检结果",
    ]);
  });

  it("does not require Major preflight data for non-Major matches", () => {
    expect(getAdminMatchStartBlockers({
      requiresPreflight: false,
      teamAName: "Alpha",
      teamBName: "Beta",
      teamARoster: roster,
      teamBRoster: roster,
      teamAPreflight: null,
      teamBPreflight: null,
    })).toEqual([]);
  });

  it("renders the authoritative blocker state on a scheduled match row", () => {
    render(
      <AdminMatchRow
        match={{
          id: "match-1",
          status: "scheduled",
          format: "bo1",
          isForfeit: false,
          scoreA: null,
          scoreB: null,
          scheduledAt: null,
          completionDeadline: null,
          teamAId: "team-a",
          teamBId: "team-b",
          ownership: "major_stage",
          bracketNodeId: null,
          completedAt: null,
        }}
        teamAName="Alpha"
        teamBName="Beta"
        seasonSlug="local-major"
        mapPool={[]}
        teamAMembers={[]}
        teamBMembers={[]}
        teamARoster={roster}
        teamBRoster={roster}
        teamAPreflight={null}
        teamBPreflight={null}
        completedMaps={[]}
        pendingMaps={[]}
        finishedMaps={[]}
      />,
    );

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
