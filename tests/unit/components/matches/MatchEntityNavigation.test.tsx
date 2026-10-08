import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useParams: () => ({ seasonSlug: "event" }) }));
const { forfeit } = vi.hoisted(() => ({ forfeit: vi.fn() }));
vi.mock("@/actions/matches", () => ({ forfeitMatch: forfeit }));
import { MatchRecentResults } from "@/components/matches/MatchRecentResults";
import { MatchMapProfile } from "@/components/matches/MatchMapProfile";
import { MatchHeadToHead } from "@/components/matches/MatchHeadToHead";
import { ForfeitButton } from "@/components/matches/ForfeitButton";

const identity = { entryAId: "a", entryBId: "b", teamAName: "Alpha", teamBName: "Beta", seasonSlug: "event" };
describe("match identity navigation", () => {
  it("retains independent recent-match and opponent destinations without nested links", () => {
    const { container } = render(<MatchRecentResults {...identity} teamA={[{ matchId: "past", opponentId: "c", opponentName: "Gamma", scoreFor: 2, scoreAgainst: 1, won: true, format: "bo3", playedAt: new Date() }]} teamB={[]} />);
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/event/teams/a");
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/event/teams/b");
    expect(screen.getByRole("link", { name: "Gamma" })).toHaveAttribute("href", "/event/teams/c");
    expect(screen.getByRole("link", { name: "查看对阵 Gamma 的比赛" })).toHaveAttribute("href", "/event/matches/past");
    expect(container.querySelector("a a, button a, a button")).toBeNull();
  });
  it("links map-analysis and H2H identities to the current event", () => {
    render(<><MatchMapProfile {...identity} rows={[]} /><MatchHeadToHead {...identity} teamAWins={1} teamBWins={0} matches={[{ matchId: "past", scheduledAt: null, completedAt: new Date(), stage: "final", format: "bo3", scoreA: 2, scoreB: 0, teamAWon: true }]} /></>);
    for (const [name, id] of [["Alpha", "a"], ["Beta", "b"]]) {
      for (const link of screen.getAllByRole("link", { name })) expect(link).toHaveAttribute("href", `/event/teams/${id}`);
    }
  });
  it("keeps team profile clicks separate from the destructive forfeit action", async () => {
    const { container } = render(<ForfeitButton {...identity} matchId="match" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "判负弃赛" }));
    await user.type(screen.getByPlaceholderText("例如：超过宽限仍无法组成合法首发"), "已核对原因");
    expect(screen.getByRole("button", { name: "Alpha 弃赛" })).toBeEnabled();
    const link = screen.getByRole("link", { name: "查看 Alpha 队伍资料" });
    expect(link).toHaveAttribute("href", "/event/teams/a");
    link.addEventListener("click", event => event.preventDefault());
    fireEvent.click(link);
    expect(forfeit).not.toHaveBeenCalled();
    expect(container.querySelector("a a, button a, a button")).toBeNull();
  });
});
