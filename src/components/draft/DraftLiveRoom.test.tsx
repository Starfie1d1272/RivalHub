import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DraftLiveRoom } from "./DraftLiveRoom";
import { useRoutePolling } from "@/components/use-visible-polling";
import type { PublicDraftData } from "@/lib/draft/data";
vi.mock("@/components/use-visible-polling", () => ({ useRoutePolling: vi.fn() }));
vi.mock("./TeamDraftGrid", () => ({ TeamDraftGrid: () => null }));
vi.mock("./PlayerPool", () => ({ PlayerPool: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const data: PublicDraftData = { state: null, teams: [], snakeOrder: [], remainingPlayers: [], completedPicks: [], totalPicks: 0, maxPicks: 48 };
// Protect the previous readonly => no-refresh bug without granting spectator mutations.
it("refreshes a readonly preview but stops refreshing an archive and a completed room", () => {
  const view = render(<DraftLiveRoom data={data} seasonPositions={[]} readonly mode="preview" />);
  expect(useRoutePolling).toHaveBeenLastCalledWith(30_000);
  view.rerender(<DraftLiveRoom data={data} seasonPositions={[]} readonly mode="archive" />);
  expect(useRoutePolling).toHaveBeenLastCalledWith(null);
  view.rerender(<DraftLiveRoom data={{ ...data, totalPicks: 48 }} seasonPositions={[]} mode="live" />);
  expect(useRoutePolling).toHaveBeenLastCalledWith(null);
});
