import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { TeamMatches } from "@/components/teams/TeamMatches";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";
import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";

vi.mock("@/components/recruitment/RecruitmentInterestButton", () => ({ RecruitmentInterestButton: () => <button>申请加入</button> }));
afterEach(cleanup);

const team: PublicTeamProfile = {
  team: { id: "long", slug: "current", name: "Current name", logoUrl: null, description: null, status: "active", captainUserId: "new-player" },
  currentMembers: [{ id: "membership", userId: "new-player", name: "Current player", avatarUrl: null, status: "benched" }],
  entries: [], nameChanges: [], captainChanges: [], playedCount: 8, wins: 7,
  currentUserMembership: null, recruitment: null, viewerInterested: false, viewerInvited: false, loggedIn: false,
};
const event: PublicEventTeamContext = {
  season: { id: "old", slug: "old-event", name: "Old event", status: "finished" },
  entry: { id: "entry", name: "Historical name", logoUrl: null, registrationStatus: "approved", representativeUserId: "old-player", teamId: "long" },
  roster: [{ userId: "old-player", name: "Historical player", avatarUrl: null, isStarter: true }],
  rosterLabel: "本届名单", rosterStatus: "frozen", seed: null, seedPresentation: null,
  participation: { label: "已参赛", tone: "neutral", detail: "" },
  record: { played: 3, wins: 2, losses: 1, winRate: "67%" }, matches: [],
};

// Shared composition must not replace frozen event identities with current team
// membership or career results. This renders both real composition branches.
it("keeps historical roster and event record separate from the current long team", () => {
  const view = render(<TeamPublicProfile team={team} event={event} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Historical name");
  expect(screen.getByRole("link", { name: "Historical player" })).toHaveAttribute("href", "/players/old-player");
  expect(screen.queryByRole("link", { name: "Current player" })).not.toBeInTheDocument();
  expect(screen.getByText("2-1")).toBeInTheDocument();
  view.rerender(<TeamPublicProfile team={team} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Current name");
  expect(screen.getByRole("link", { name: "Current player" })).toHaveAttribute("href", "/players/new-player");
  expect(screen.queryByRole("link", { name: "Historical player" })).not.toBeInTheDocument();
  expect(screen.getByText("7-1")).toBeInTheDocument();
});

it("preserves the canonical display score and event destination across a career match list", () => {
  render(<TeamMatches matches={[{
    id: "bo3", seasonSlug: "rivals", seasonName: "Rivals", opponentId: "other", opponentName: "Opponent",
    status: "finished", isForfeit: false, scheduledAt: null, completedAt: new Date(),
    ownScore: 26, opponentScore: 20, displayScore: { own: 2, opponent: 0 },
  }]} />);
  const match = screen.getByRole("link", { name: /Opponent/ });
  expect(match).toHaveAttribute("href", "/rivals/matches/bo3");
  expect(match).toHaveTextContent("2 : 0");
  expect(match).not.toHaveTextContent("26 : 20");
});
