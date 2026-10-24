import { act, render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DraftLiveRoom } from "./DraftLiveRoom";
import type { PublicDraftData } from "@/lib/draft/data";
const { read, refresh } = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }));
vi.mock("@/actions/public-draft", () => ({ readPublicDraft: read }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./TeamDraftGrid", () => ({ TeamDraftGrid: () => null }));
vi.mock("./PlayerPool", () => ({ PlayerPool: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const data: PublicDraftData = { state: null, teams: [], snakeOrder: [], remainingPlayers: [], completedPicks: [], totalPicks: 0, maxPicks: 48 };
// Protect readonly spectator updates and termination with the real visibility hook.
it("reads a readonly preview without route refresh and stops after archive or completion", async () => {
  vi.useFakeTimers();
  read.mockResolvedValue({ success: true, data: { data, mode: "preview" } });
  const view = render(<DraftLiveRoom seasonSlug="event" data={data} seasonPositions={[]} readonly mode="preview" />);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(read).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  view.rerender(<DraftLiveRoom seasonSlug="event" data={data} seasonPositions={[]} readonly mode="archive" />);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(read).toHaveBeenCalledTimes(1);
  view.rerender(<DraftLiveRoom seasonSlug="event" data={{ ...data, totalPicks: 48 }} seasonPositions={[]} mode="live" />);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(read).toHaveBeenCalledTimes(1);
});
