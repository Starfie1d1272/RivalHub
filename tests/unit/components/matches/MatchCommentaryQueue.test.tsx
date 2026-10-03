import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminMatchCommentaryData } from "@/lib/admin/matches/commentary";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/rivalhub", () => ({ Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/matches/ClaimMatchButton", () => ({ ClaimMatchButton: ({ matchId }: { matchId: string }) => <button data-match-id={matchId}>由我负责本场</button> }));
import { MatchCommentaryQueue, MatchCommentaryStatus } from "@/components/matches/MatchCommentaryQueue";

const empty: AdminMatchCommentaryData = { currentMatches: [], nextMatch: null, unclaimedMatches: [], unclaimedCount: 0, byMatchId: {} };

describe("personal commentary queue", () => {
  it("keeps missing assignment as a normal empty state", () => {
    render(<MatchCommentaryQueue data={empty} seasonSlug="major" />);
    expect(screen.getByText("当前没有已认领的下一场")).toBeInTheDocument();
    expect(screen.getByText("当前没有待认领的比赛")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("links current, upcoming and unclaimed matches to their real workbenches", () => {
    const upcoming = { id: "next", teamAName: "Alpha", teamBName: "Beta", scheduledAt: new Date("2026-10-01T12:30:00Z"), status: "scheduled" as const };
    render(<MatchCommentaryQueue seasonSlug="major" data={{
      ...empty,
      currentMatches: [{ ...upcoming, id: "current", status: "in_progress" }],
      nextMatch: upcoming,
      unclaimedMatches: [{ ...upcoming, id: "unclaimed", scheduledAt: null }],
      unclaimedCount: 1,
      byMatchId: { unclaimed: { commentators: [], isMine: false, canClaim: true } },
    }} />);
    const current = screen.getByRole("region", { name: "我的当前比赛" });
    expect(within(current).getByRole("link")).toHaveAttribute("href", "/admin/major/matches/current");
    const next = screen.getByRole("region", { name: "我的下一场" });
    expect(within(next).getByRole("link")).toHaveAttribute("href", "/admin/major/matches/next");
    expect(within(next).getByRole("link")).toHaveTextContent("20:30");
    expect(screen.getByRole("button", { name: "由我负责本场" })).toHaveAttribute("data-match-id", "unclaimed");
  });

  it("displays actual commentators and does not present an occupied slot as unclaimed", () => {
    render(<MatchCommentaryStatus matchId="match" assignment={{ commentators: [{ userId: "me", name: "解说甲" }], isMine: true, canClaim: false }} />);
    expect(screen.getByRole("link", { name: "解说甲" })).toHaveAttribute("href", "/players/me");
    expect(screen.getByText("你已负责本场")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
