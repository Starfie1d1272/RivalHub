import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MatchContextRefresh } from "@/components/matches/MatchContextRefresh";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";

const { refresh, readToken } = vi.hoisted(() => ({ refresh: vi.fn(), readToken: vi.fn() }));
vi.mock("@/actions/public-match-refresh", () => ({ readPublicMatchRefreshToken: readToken }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/actions/matches/scheduling", () => ({
  proposeMatchTime: vi.fn(), respondToTimeProposal: vi.fn(), forceSetMatchTime: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The scheduling dialog and page share an RSC refresh: a second timer amplifies
// every server-side page read. Exercise both real components and polling hooks.
it("polls only the change token while idle, and refreshes changed facts after tab recovery", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T02:00:00Z"));
  refresh.mockClear();
  readToken.mockReset().mockResolvedValue({ success: true, data: "initial" });
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  render(<>
    <MatchContextRefresh enabled seasonSlug="isolated" scope={{ matchId: "match" }} />
    <MatchTimeNegotiation matchId="match" isCaptainA isCaptainB={false} isAdmin={false}
      currentScheduledAt={null} currentCompletionDeadline={null} hasSubmittedRoster
      initialProposals={[{ id: "proposal", status: "pending", proposedTime: new Date("2026-10-14T12:00:00Z"),
        responseAt: null, rejectReason: null, createdAt: new Date(), isMine: false }]} />
  </>);
  for (let tick = 0; tick < 8; tick++) await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(readToken).toHaveBeenCalledTimes(8);
  expect(refresh).toHaveBeenCalledTimes(1);
  visibility = "hidden";
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(readToken).toHaveBeenCalledTimes(8);
  expect(refresh).toHaveBeenCalledTimes(1);
  readToken.mockResolvedValue({ success: true, data: "changed" });
  visibility = "visible";
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(readToken).toHaveBeenCalledTimes(9);
  expect(refresh).toHaveBeenCalledTimes(2);
});
