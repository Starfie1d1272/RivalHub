/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
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
  it("renders the shared avatar in the active candidate cards", () => {
    render(
      <MatchMvpVote
        matchId="match-1"
        candidates={[candidate("Neo", "user-1"), candidate("Sage", "user-2")]}
        currentVotes={[]}
        userVotedPlayerName={null}
        completedAt="2099-01-01T00:00:00.000Z"
      />,
    );

    expect(screen.getByRole("img", { name: "Neo" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sage" })).toBeInTheDocument();
  });
});
