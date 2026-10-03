import React, { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { initialLiveViewerState, type LiveViewerState } from "@/lib/mizar/live-viewer-state";
import { MatchLiveProvider, useMatchLive } from "./MatchLiveProvider";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/mizar/live-viewer", () => ({ connectLiveViewer: mocks.connect, browserViewerEnvironment: () => ({}) }));
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
