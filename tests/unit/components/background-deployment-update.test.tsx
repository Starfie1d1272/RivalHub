import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

const mocks = vi.hoisted(() => ({ heartbeat: vi.fn(), match: vi.fn(), refresh: vi.fn(), path: "/" }));
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), useRouter: () => ({ refresh: mocks.refresh }), usePathname: () => mocks.path }));
vi.mock("@/actions/online", () => ({ heartbeatOnline: mocks.heartbeat }));
vi.mock("@/actions/public-match-refresh", () => ({ readPublicMatchRefreshToken: mocks.match }));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mocks.path = "/"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("pauses both automatic actions and preserves a draft until an explicit confirmation", async () => {
  const { OnlineCounter } = await import("@/components/layout/OnlineCounter");
  const { MatchContextRefresh } = await import("@/components/matches/MatchContextRefresh");
  const { DeploymentUpdateNotice } = await import("@/components/layout/DeploymentUpdateNotice");
  const { useVisiblePolling } = await import("@/components/use-visible-polling");
  const stableRead = vi.fn();
  function StableHttpConsumer() { useVisiblePolling(stableRead, 10_000); return null; }
  let visible: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => visible === "hidden");
  mocks.heartbeat.mockRejectedValueOnce(new UnrecognizedActionError("fixture"));
  mocks.match.mockResolvedValue({ success: true, data: "ok" });
  const reload = vi.fn(); const originalWindow = window;
  vi.stubGlobal("window", new Proxy(originalWindow, { get(target, key) { return key === "location" ? { reload } : Reflect.get(target, key, target); } }));
  render(<><input aria-label="草稿" defaultValue="未保存内容" /><DeploymentUpdateNotice /><OnlineCounter /><MatchContextRefresh enabled seasonSlug="event" scope={{ matchId: "match" }} /><StableHttpConsumer /></>);
  await act(async () => {});
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(130_000));
  visible = "hidden"; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  visible = "visible"; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
  expect(mocks.match).not.toHaveBeenCalled();
  expect(stableRead).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "更新页面" }));
  expect(screen.getByText("未保存内容会丢失。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByLabelText("草稿")).toHaveValue("未保存内容");
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "更新页面" }));
  fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
  expect(reload).toHaveBeenCalledOnce();
});

it("keeps ordinary network failure recovery and does not signal an update", async () => {
  const { OnlineCounter } = await import("@/components/layout/OnlineCounter");
  const { MatchContextRefresh } = await import("@/components/matches/MatchContextRefresh");
  const { DeploymentUpdateNotice } = await import("@/components/layout/DeploymentUpdateNotice");
  mocks.heartbeat.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ count: 1, windowSeconds: 300, intervalMs: 60_000 });
  mocks.match.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ success: true, data: "ok" });
  render(<><DeploymentUpdateNotice /><OnlineCounter /><MatchContextRefresh enabled seasonSlug="event" scope={{ matchId: "match" }} /></>);
  for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  expect(mocks.match).toHaveBeenCalledTimes(4);
  expect(mocks.refresh).toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("stops the match action after its own version error without refreshing the route", async () => {
  const { MatchContextRefresh } = await import("@/components/matches/MatchContextRefresh");
  const { DeploymentUpdateNotice } = await import("@/components/layout/DeploymentUpdateNotice");
  mocks.match.mockRejectedValueOnce(new UnrecognizedActionError("fixture"));
  render(<><DeploymentUpdateNotice /><MatchContextRefresh enabled seasonSlug="event" scope={{ matchId: "match" }} /></>);
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(mocks.match).toHaveBeenCalledTimes(1);
});
