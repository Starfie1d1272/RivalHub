import React, { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { initialLiveViewerState, type LiveViewerState } from "@/lib/mizar/live-viewer-state";
import { MatchLiveProvider, useMatchLive } from "./MatchLiveProvider";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), stop: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/mizar/live-viewer-subscriptions", () => ({ subscribeBrowserLiveViewer: mocks.connect }));
vi.mock("@/lib/mizar/live-previous-view", () => ({ browserPreviousLiveViewStore: () => ({ clear: mocks.clear }) }));
function Consumer() { return <span>frame {useMatchLive().state.acceptedFrames}</span>; }
it("shares one receiver across consumers and disposes it on match/visibility changes", () => {
  let receive: (state: LiveViewerState) => void = () => {};
  mocks.connect.mockImplementation((_id, callback) => { receive = callback; return mocks.stop; });
  const content = (id: string, enabled = true) => <MatchLiveProvider matchId={id} enabled={enabled}><Consumer /><Consumer /></MatchLiveProvider>;
  const view = render(content("a"));
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  act(() => receive({ ...initialLiveViewerState(), acceptedFrames: 2 }));
  expect(screen.getAllByText("frame 2")).toHaveLength(2);
  view.rerender(content("b"));
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("frame 0")).toHaveLength(2);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  view.rerender(content("b", false));
  expect(mocks.stop).toHaveBeenCalledTimes(2);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  view.rerender(content("b"));
  expect(mocks.connect).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(mocks.stop).toHaveBeenCalledTimes(3);
});

it("cleans the Strict Mode probe before establishing the lasting receiver", () => {
  mocks.connect.mockClear(); mocks.stop.mockClear();
  mocks.connect.mockReturnValue(mocks.stop);
  const view = render(<StrictMode><MatchLiveProvider matchId="strict"><Consumer /><Consumer /></MatchLiveProvider></StrictMode>);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("frame 0")).toHaveLength(2);
  view.unmount();
  expect(mocks.stop).toHaveBeenCalledTimes(2);
});

it("uses the current monotonic time for the first state delivered on re-entry", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(10000);
  mocks.connect.mockImplementation((_id, receive) => {
    receive({ ...initialLiveViewerState(), receivedAt: 1000 });
    return mocks.stop;
  });
  function Age() {
    const { state, now } = useMatchLive();
    return <span>age {now - (state.receivedAt ?? now)}</span>;
  }
  const view = render(<MatchLiveProvider matchId="reentry"><Age /></MatchLiveProvider>);
  expect(screen.getByText("age 9000")).toBeVisible();
  view.unmount(); clock.mockRestore();
});

it("releases an invisible consumer without revoking shared proof, but clears an ineligible match", () => {
  mocks.clear.mockClear(); mocks.connect.mockClear(); mocks.stop.mockClear();
  mocks.connect.mockReturnValue(mocks.stop);
  const content = (enabled: boolean, eligible: boolean) => <MatchLiveProvider matchId="visibility" enabled={enabled} eligible={eligible}><Consumer /></MatchLiveProvider>;
  const view = render(content(false, true));
  expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
  view.rerender(content(true, true));
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  view.rerender(content(false, true));
  expect(mocks.stop).toHaveBeenCalledTimes(1); expect(mocks.clear).not.toHaveBeenCalled();
  view.rerender(content(true, false));
  expect(mocks.clear).toHaveBeenCalledWith("visibility"); expect(mocks.connect).toHaveBeenCalledTimes(1);
  view.unmount();
});
