/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";

vi.mock("@/actions/player-stats", () => ({ castMatchMvpVote: vi.fn() }));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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

describe("MVP result refresh", () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const props = {
    matchId: "match-1", candidates: [candidate("Neo", "user-1")],
    currentVotes: [], userVotedPlayerName: null, completedAt: "2026-10-01T12:00:00Z",
    winnerUserId: null,
  };
  function visibility(value: "hidden" | "visible") {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    refresh.mockClear();
    visibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    else Reflect.deleteProperty(document, "visibilityState");
  });

  it("shows winner secondary and scoped advanced metrics without inventing missing values", () => {
    const performance = { playerId: "user-1", rounds: 20, kast: { rate: .75, successes: 15, attempts: 20 }, trade: { rate: .1, successes: 2, attempts: 20 }, utility: { rate: null }, flashAssist: { rate: 0, successes: 0, attempts: 20 } };
    const { rerender } = render(<MatchMvpVote {...props} winnerUserId="user-1" winnerPerformance={performance} />);
    expect(screen.getByLabelText("MVP 关键表现")).toHaveTextContent(/CL\s*\?0/);
    const advanced = screen.getByLabelText("MVP 进阶表现");
    expect(advanced).toHaveTextContent("20 rounds"); expect(advanced).toHaveTextContent("75.0%"); expect(advanced).toHaveTextContent(/Util\/r\s*\?—/);
    fireEvent.click(screen.getByRole("button", { name: "MK 指标说明" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("本场取得至少双杀的回合数。");
    rerender(<MatchMvpVote {...props} winnerUserId="user-1" winnerPerformance={{ ...performance, playerId: "someone-else" }} />);
    expect(screen.queryByLabelText("MVP 进阶表现")).not.toBeInTheDocument();
  });
  it("refreshes an initially empty closed snapshot and stops once the committed winner arrives", async () => {
    const { rerender, unmount } = render(<MatchMvpVote {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<MatchMvpVote {...props} currentVotes={[{ playerUserId: "user-1", playerName: "Neo", count: 1 }]} winnerUserId="user-1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "刷新 MVP 结果" })).not.toBeInTheDocument();
    unmount();
  });

  it("makes no hidden-tab requests and resumes on visibility", async () => {
    visibility("hidden");
    const { unmount } = render(<MatchMvpVote {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => visibility("visible"));
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("bounds no-vote polling and preserves a manual refresh after the window", async () => {
    const { unmount } = render(<MatchMvpVote {...props} />);
    for (let minute = 0; minute < 16; minute++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    }
    const calls = refresh.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(15);
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000); });
    expect(refresh).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole("button", { name: "刷新 MVP 结果" }));
    expect(refresh).toHaveBeenCalledTimes(calls + 1);
    unmount();
  });
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
    expect(screen.getByText("暂无 MVP 结果")).toBeInTheDocument();
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

});
