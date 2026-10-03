import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";
import { projectPublicLive } from "@/lib/mizar/live-projection";
import { initialLiveViewerState, receivePublicLive } from "@/lib/mizar/live-viewer-state";
import { PreMatchContext } from "./PreMatchContext";

const snapshot = projectPublicLive(parseLiveSnapshotV1(fixture.snapshot), 1, fixture.snapshot.producedAt);
const live = { state: receivePublicLive(initialLiveViewerState(), snapshot, snapshot.matchId, 0), now: 0 };
vi.mock("./MatchLiveProvider", () => ({ useMatchLive: () => live }));
afterEach(cleanup);
const view = (phase: "gameplay" | "awaiting_gameplay" | "inter_map" = "gameplay") => <PreMatchContext phase={phase} currentMapId={snapshot.map.mapId}><p>真实赛前资料</p></PreMatchContext>;

describe("pre-match context availability", () => {
  it("keeps waiting and inter-map scouting visible even when an old frame is fresh", () => {
    live.now = 0;
    const page = render(view("awaiting_gameplay"));
    expect(screen.getByText("真实赛前资料")).toBeVisible();
    page.rerender(view("inter_map"));
    expect(screen.getByText("真实赛前资料")).toBeVisible();
  });
  it("does not jump on stale, restores canonical content on unavailable, and respects manual expansion", () => {
    live.now = 0;
    const page = render(view());
    expect(screen.getByText("真实赛前资料")).not.toBeVisible();
    live.now = 3001; page.rerender(view());
    expect(screen.getByText("真实赛前资料")).not.toBeVisible();
    live.now = 10001; page.rerender(view());
    expect(screen.getByText("真实赛前资料")).toBeVisible();
    live.now = 0; page.rerender(view());
    fireEvent.click(screen.getByRole("button", { name: "阵容与赛前资料" }));
    live.now = 10001; page.rerender(view());
    live.now = 0; page.rerender(view());
    expect(screen.getByText("真实赛前资料")).toBeVisible();
  });
});
