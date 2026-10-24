import { useVisiblePolling } from "@/components/use-visible-polling";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MatchContextRefresh } from "@/components/matches/MatchContextRefresh";
import { CaptainVotingPanel } from "@/components/captains/CaptainVotingPanel";
import { DraftLiveRoom } from "@/components/draft/DraftLiveRoom";
import type { PublicDraftData } from "@/lib/draft/data";
const { match, captains, draft, refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn(); return { match: vi.fn(), captains: vi.fn(), draft: vi.fn(), refresh, router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/actions/public-match-refresh", () => ({ readPublicMatchRefreshToken: match }));
vi.mock("@/actions/public-captain-voting", () => ({ readPublicCaptainVoting: captains }));
vi.mock("@/actions/public-draft", () => ({ readPublicDraft: draft }));
vi.mock("@/actions/captains", () => ({ castVote: vi.fn(), retractVote: vi.fn() }));
vi.mock("@/components/draft/TeamDraftGrid", () => ({ TeamDraftGrid: () => null }));
vi.mock("@/components/draft/PlayerPool", () => ({ PlayerPool: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); [match, captains, draft, refresh].forEach(mock => mock.mockReset()); });
const draftData: PublicDraftData = { state: null, teams: [], snakeOrder: [], remainingPlayers: [], completedPicks: [], totalPicks: 0, maxPicks: 48 };
const candidates: never[] = [], votes: never[] = [];
const cases = [
  { name: "match", read: match, interval: 15000, result: { success: true, data: "after-commit" }, node: (enabled: boolean, slug = "event") => <MatchContextRefresh enabled={enabled} seasonSlug={slug} scope={{ matchId: "match" }} /> },
  { name: "captains", read: captains, interval: 10000, result: { success: true, data: { seasonStatus: "drafting", candidates: [], currentVoter: null, votes: [] } }, node: (enabled: boolean, slug = "event") => <CaptainVotingPanel seasonSlug={slug} seasonName="Event" seasonStatus="voting" candidates={candidates} votes={votes} currentVoter={null} viewerPending={!enabled} /> },
  { name: "draft", read: draft, interval: 30000, result: { success: true, data: { data: draftData, mode: "archive" } }, node: (enabled: boolean, slug = "event") => <DraftLiveRoom seasonSlug={slug} data={draftData} seasonPositions={[]} mode={enabled ? "preview" : "archive"} readonly /> },
];
for (const testCase of cases) {
  for (const transition of ["hidden", "disabled", "scope"] as const) {
    it(`discards ${testCase.name} pending results after ${transition} and rechecks on recovery`, async () => {
      vi.useFakeTimers();
      let visibility: DocumentVisibilityState = "visible";
      vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
      let complete!: () => void;
      testCase.read.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve(testCase.result); }));
      const view = render(testCase.node(true));
      await act(() => vi.advanceTimersByTimeAsync(testCase.interval));
      expect(testCase.read).toHaveBeenCalledTimes(1);
      if (transition === "hidden") {
        visibility = "hidden";
        await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      } else view.rerender(testCase.node(transition === "scope", transition === "scope" ? "next-event" : "event"));
      await act(async () => { complete(); });
      expect(refresh).not.toHaveBeenCalled();
      testCase.read.mockResolvedValue(testCase.result);
      if (transition === "hidden") {
        visibility = "visible";
        await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      } else {
        view.rerender(testCase.node(true, transition === "scope" ? "next-event" : "event"));
        await act(() => vi.advanceTimersByTimeAsync(testCase.interval));
      }
      expect(testCase.read).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  }
}

it("establishes the first token before refresh and resyncs exactly 120 seconds after that sync", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
  let complete!: () => void;
  // The rendered core may precede a canonical commit. A later first token
  // must always refresh, rather than accepting that token as proof of old UI.
  match.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve({ success: true, data: "committed-during-gap" }); }));
  render(<MatchContextRefresh enabled seasonSlug="event" scope={{ matchId: "match" }} />);
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(async () => { complete(); });
  expect(refresh).toHaveBeenCalledTimes(1);
  match.mockResolvedValue({ success: true, data: "committed-during-gap" });
  await act(() => vi.advanceTimersByTimeAsync(105000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("starts a fresh check after recovery while an obsolete request was still in flight", async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  let complete!: () => void;
  match.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve({ success: true, data: "obsolete" }); }));
  match.mockResolvedValue({ success: true, data: "fresh" });
  render(<MatchContextRefresh enabled seasonSlug="event" scope={{ matchId: "match" }} />);
  await act(() => vi.advanceTimersByTimeAsync(15000));
  visibility = "hidden";
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  visibility = "visible";
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(match).toHaveBeenCalledTimes(1);
  await act(async () => { complete(); });
  expect(match).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("keeps background callbacks out of their optional explicit-announcement mode", async () => {
  vi.useFakeTimers();
  let reads = 0;
  function CompatibleConsumer() {
    useVisiblePolling((announce = false) => { reads++; if (announce) refresh(); }, 1000);
    return null;
  }
  render(<CompatibleConsumer />);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(reads).toBe(1);
  expect(refresh).not.toHaveBeenCalled();
});
