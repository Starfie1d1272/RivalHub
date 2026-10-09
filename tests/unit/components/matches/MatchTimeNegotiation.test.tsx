/** UI evidence: consent stays available in short windows and provenance must
 * come from persisted resolution, not elapsed time. DB owns timeout boundaries. */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
vi.mock("@/actions/matches/scheduling", () => ({
  proposeMatchTime: vi.fn(), respondToTimeProposal: vi.fn(), forceSetMatchTime: vi.fn(),
}));
vi.mock("@/components/use-visible-polling", () => ({ useRoutePolling: vi.fn() }));
const now = Date.now();
const proposedTime = new Date(now + 30 * 60_000);
const props = {
  matchId: "match", isCaptainA: true, isCaptainB: false, isAdmin: false,
  currentScheduledAt: null, currentCompletionDeadline: new Date(now + 60 * 60_000),
  hasSubmittedRoster: false,
};
it("allows responding in a short window without a lineup and recommends lineup-first consent", () => {
  render(<MatchTimeNegotiation {...props} initialProposals={[{
    id: "proposal", status: "pending", proposedTime, createdAt: new Date(now),
    responseAt: null, resolution: null, rejectReason: null, isMine: false,
  }]} />);
  expect(screen.getByRole("button", { name: "接受" })).toBeEnabled();
  expect(screen.getByLabelText("提议新时间")).toBeInTheDocument();
  expect(screen.getByText(/若需使用非预定主力/)).toBeInTheDocument();
  expect(screen.getByText(/需双方明确确认或联系管理员/)).toBeInTheDocument();
});
it("does not label delayed participant consent as automatic", () => {
  render(<MatchTimeNegotiation {...props} currentScheduledAt={proposedTime} initialProposals={[{
    id: "proposal", status: "accepted", proposedTime, createdAt: new Date(now - 25 * 3_600_000),
    responseAt: new Date(now), resolution: "participant_accept", rejectReason: null, isMine: false,
  }]} />);
  expect(screen.queryByText("比赛时间已自动设定")).not.toBeInTheDocument();
});
