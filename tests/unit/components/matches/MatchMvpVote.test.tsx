/** @vitest-environment jsdom */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";

vi.mock("@/actions/player-stats", () => ({ castMatchMvpVote: vi.fn() }));

const candidate = (perfectName: string, userId: string) => ({
  userId,
  avatarUrl: null,
  perfectName,
  kills: 20,
  deaths: 10,
  assists: 5,
  hsPercent: 50,
  firstKills: 2,
  multiKills: 1,
  clutches: 0,
  adr: 90,
  rws: 10,
  ratingPro: 1.2,
  we: 8,
});

describe("MatchMvpVote", () => {
  it("uses canonical identity after a player rename and follows updated server vote counts", () => {
    const props = {
      matchId: "match-1", candidates: [candidate("New Name", "user-1")],
      userVotedPlayerName: null, completedAt: "2099-01-01T00:00:00.000Z",
      winnerUserId: null,
    };
    const { rerender } = render(<MatchMvpVote {...props} currentVotes={[{ playerUserId: "user-1", playerName: "Old Name", count: 2 }]} />);
    expect(within(screen.getByRole("button")).getByText("2 票")).toBeInTheDocument();
    rerender(<MatchMvpVote {...props} currentVotes={[{ playerUserId: "user-1", playerName: "Old Name", count: 3 }]} />);
    expect(within(screen.getByRole("button")).getByText("3 票")).toBeInTheDocument();
  });

  it("does not invent a winner for a closed match with no votes", () => {
    render(<MatchMvpVote matchId="match-1" candidates={[candidate("Neo", "user-1")]} currentVotes={[]} userVotedPlayerName={null} completedAt="2020-01-01T00:00:00.000Z" winnerUserId={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("waits for the committed winner instead of declaring a read-time result", () => {
    const props = {
      matchId: "match-1", candidates: [candidate("Neo", "user-1")],
      currentVotes: [{ playerUserId: "user-1", playerName: "Neo", count: 2 }],
      userVotedPlayerName: null, completedAt: "2020-01-01T00:00:00.000Z",
    };
    const { rerender } = render(<MatchMvpVote {...props} winnerUserId={null} />);
    expect(screen.getByText("MVP 结果确认中")).toBeInTheDocument();
    rerender(<MatchMvpVote {...props} winnerUserId="user-1" />);
    expect(screen.queryByText("MVP 结果确认中")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Neo" })).toHaveAttribute("href", "/players/user-1");
    rerender(<MatchMvpVote {...props} completedAt="2099-01-01T00:00:00.000Z" winnerUserId="user-1" />);
    expect(screen.getByText("本场 MVP")).toBeInTheDocument();
    expect(screen.queryByText("本场 MVP 投票")).not.toBeInTheDocument();
  });

  it("renders the shared avatar in the active candidate cards", () => {
    render(
      <MatchMvpVote
        matchId="match-1"
        candidates={[candidate("Neo", "user-1"), candidate("Sage", "user-2")]}
        currentVotes={[]}
        userVotedPlayerName={null}
        completedAt="2099-01-01T00:00:00.000Z"
        winnerUserId={null}
      />,
    );

    expect(screen.getByRole("img", { name: "Neo" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sage" })).toBeInTheDocument();
  });
});
