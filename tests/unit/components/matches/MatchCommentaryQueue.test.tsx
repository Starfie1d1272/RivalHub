import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminMatchCommentaryData } from "@/lib/admin/matches/commentary";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/rivalhub", () => ({ Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/matches/ClaimMatchButton", () => ({ ClaimMatchButton: ({ matchId }: { matchId: string }) => <button data-match-id={matchId}>认领本场解说</button> }));
import { MatchCommentaryQueue, MatchCommentaryStatus } from "@/components/matches/MatchCommentaryQueue";

const empty: AdminMatchCommentaryData = { currentMatches: [], nextMatch: null, claimableMatches: [], claimableCount: 0, byMatchId: {} };

describe("personal commentary queue", () => {
  it("keeps missing assignment as a normal empty state", () => {
    render(<MatchCommentaryQueue data={empty} seasonSlug="major" />);
    expect(screen.getByText("当前没有已认领的下一场")).toBeInTheDocument();
    expect(screen.getByText("当前没有待认领的比赛")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("links current, upcoming and claimable matches to their real workbenches", () => {
    const upcoming = { id: "next", entryAId: "alpha", entryBId: "beta", teamAName: "Alpha", teamBName: "Beta", scheduledAt: new Date("2026-10-01T12:30:00Z"), status: "scheduled" as const };
    render(<MatchCommentaryQueue seasonSlug="major" data={{
      ...empty,
      currentMatches: [{ ...upcoming, id: "current", status: "in_progress" }],
      nextMatch: upcoming,
      claimableMatches: [{ ...upcoming, id: "unclaimed", scheduledAt: null }],
      claimableCount: 1,
      byMatchId: { unclaimed: { commentators: [], isMine: false, canClaim: true } },
    }} />);
    const current = screen.getByRole("region", { name: "我的当前比赛" });
    expect(within(current).getByRole("link", { name: /进入比赛工作台/ })).toHaveAttribute("href", "/admin/major/matches/current");
    expect(within(current).getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/major/teams/alpha");
    expect(current.querySelector("a a, a button, button a")).toBeNull();
    const next = screen.getByRole("region", { name: "我的下一场" });
    expect(within(next).getByRole("link", { name: /进入比赛工作台/ })).toHaveAttribute("href", "/admin/major/matches/next");
    expect(within(next).getByRole("link", { name: /进入比赛工作台/ })).toHaveTextContent("20:30");
    expect(screen.getByRole("button", { name: "认领本场解说" })).toHaveAttribute("data-match-id", "unclaimed");
    expect(screen.getByRole("region", { name: "可认领的比赛" })).toHaveTextContent("解说 0/2");
  });

  it("keeps a one-commentator match discoverable with its remaining slot and claim action", () => {
    render(<MatchCommentaryQueue seasonSlug="major" data={{
      ...empty,
      claimableMatches: [{ id: "partial", entryAId: "alpha", entryBId: "beta", teamAName: "Alpha", teamBName: "Beta", scheduledAt: null, status: "scheduled" }],
      claimableCount: 1,
      byMatchId: { partial: { commentators: [{ userId: "other", playerUserId: null, name: "解说甲" }], isMine: false, canClaim: true } },
    }} />);
    const queue = screen.getByRole("region", { name: "可认领的比赛" });
    expect(within(queue).getByRole("link", { name: /进入比赛工作台/ })).toHaveAttribute("href", "/admin/major/matches/partial");
    expect(queue).toHaveTextContent("解说 1/2");
    expect(within(queue).getByRole("button", { name: "认领本场解说" })).toHaveAttribute("data-match-id", "partial");
  });

  it("offers the second slot when another commentator has claimed and the server allows claiming", () => {
    render(<MatchCommentaryStatus matchId="partial" assignment={{ commentators: [{ userId: "other", playerUserId: null, name: "解说甲" }], isMine: false, canClaim: true }} />);
    expect(screen.getByText("解说甲", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "认领本场解说" })).toHaveAttribute("data-match-id", "partial");
    expect(screen.queryByText("你已认领本场解说")).not.toBeInTheDocument();
  });

  it("links a commentator only when the read model also confirms their long-lived player identity", () => {
    render(<MatchCommentaryStatus matchId="match" assignment={{ commentators: [{ userId: "veteran", playerUserId: "veteran", name: "往届选手" }], isMine: false, canClaim: false }} />);
    expect(screen.getByRole("link", { name: "往届选手" })).toHaveAttribute("href", "/players/veteran");
  });

  it("shows both commentators with no claim action when the roster is full", () => {
    render(<MatchCommentaryStatus matchId="full" assignment={{ commentators: [{ userId: "a", playerUserId: null, name: "解说甲" }, { userId: "b", playerUserId: null, name: "解说乙" }], isMine: false, canClaim: false }} />);
    expect(screen.getByText("解说：", { exact: false })).toHaveTextContent("解说：解说甲、解说乙");
    expect(screen.getByText("解说乙", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("displays actual commentators and does not present an occupied slot as unclaimed", () => {
    render(<MatchCommentaryStatus matchId="match" assignment={{ commentators: [{ userId: "me", playerUserId: null, name: "解说甲" }], isMine: true, canClaim: false }} />);
    expect(screen.getByText("解说甲", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("你已认领本场解说")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
