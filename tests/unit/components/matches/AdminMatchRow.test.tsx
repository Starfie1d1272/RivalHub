/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/utils/cn", () => ({ cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ") }));
vi.mock("@/components/rivalhub", () => ({ Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, StatusPill: () => null }));
vi.mock("@/components/matches/MatchStatusBadge", () => ({ MatchStatusBadge: () => null }));

import { AdminMatchRow } from "@/components/matches/AdminMatchRow";
import { getAdminMatchStartBlockers } from "@/lib/admin/matches/start-blockers";

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
      "Alpha 尚未完成首发资格检查",
      "Beta 尚未完成首发资格检查",
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

  it("renders a scheduled match summary with the workbench entry point", () => {
    render(
      <AdminMatchRow
        match={{
          id: "match-1",
          stage: "qualifier",
          round: null,
          entryRound: null,
          status: "scheduled",
          format: "bo1",
          isForfeit: false,
          scoreA: null,
          scoreB: null,
          scheduledAt: null,
          entryAId: "team-a",
          entryBId: "team-b",
          ownership: "major_stage",
        }}
        teamAName="Alpha"
        teamBName="Beta"
        seasonSlug="local-major"
      />,
    );

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入比赛工作台 →" })).toHaveAttribute("href", "/admin/local-major/matches/match-1");
  });
});
