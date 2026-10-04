import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { initialLiveViewerState } from "@/lib/mizar/live-viewer-state";
import type { PublicLiveMatchProjection } from "@/lib/mizar/live-projection";
const live = vi.hoisted(() => ({ state: {} as ReturnType<typeof initialLiveViewerState>, now: 0 }));
vi.mock("@/components/matches/MatchLiveProvider", () => ({ useMatchLive: () => live }));
import { OperatorLiveStatusText } from "@/components/matches/OperatorLiveStatus";

it("does not turn persisted authorization into freshness, expires silent delivery, and rejects other executions", () => {
  live.state = initialLiveViewerState();
  const scope = { authorityRevision: 2, generation: 3, epoch: 4, mapId: "map" };
  const view = render(<OperatorLiveStatusText scope={scope} />);
  expect(screen.getByRole("status")).toHaveTextContent("尚未收到本图实时数据");
  live.state = { ...live.state, receivedAt: 0, snapshot: { map: { mapId: "map" }, delivery: { authorityRevision: 2, generation: 3, epoch: 4 } } as PublicLiveMatchProjection };
  live.now = 1000;
  view.rerender(<OperatorLiveStatusText scope={scope} />);
  expect(screen.getByRole("status")).toHaveTextContent("正在接收本图数据");
  live.now = 11000;
  view.rerender(<OperatorLiveStatusText scope={scope} />);
  expect(screen.getByRole("status")).toHaveTextContent("比赛数据暂未更新");
  live.now = 1000;
  view.rerender(<OperatorLiveStatusText scope={{ ...scope, generation: 5 }} />);
  expect(screen.getByRole("status")).toHaveTextContent("尚未收到本图实时数据");
});
