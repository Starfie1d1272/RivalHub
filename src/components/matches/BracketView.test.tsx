import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { BracketView } from "./BracketView";
import type { BracketData } from "@/lib/bracket";
const { capture, ready, router } = vi.hoisted(() => ({ capture: vi.fn(), ready: vi.fn(), router: { push: vi.fn() } }));
vi.mock("@/lib/telemetry/client", () => ({ captureTelemetryNavigation: capture, recordContentReady: ready }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/script", () => ({ default: function Script({ onReady }: { onReady: () => void }) { useEffect(onReady, [onReady]); return null; } }));
afterEach(() => { cleanup(); delete window.bracketsViewer; vi.clearAllMocks(); });

// A completed data fetch alone cannot claim that the imperative bracket is usable.
it("reports schedule readiness only after bracket rendering resolves", async () => {
  const token = { navigation: "fixture" };
  capture.mockReturnValue(token);
  let complete!: () => void;
  window.bracketsViewer = { render: vi.fn(() => new Promise<void>(resolve => { complete = resolve; })) };
  const data: BracketData = { stage: [{ id: 1, name: "Final", type: "single_elimination" }], group: [], round: [], match_game: [], participant: [],
    match: [{ id: 1, stage_id: 1, group_id: 1, round_id: 1, number: 1, status: 1, child_count: 0, opponent1: null, opponent2: null }],
  };
  render(<BracketView data={data} reportScheduleReady />);
  expect(ready).not.toHaveBeenCalled();
  await act(async () => { complete(); });
  expect(ready).toHaveBeenCalledExactlyOnceWith(token, "schedule", "primary");
});
