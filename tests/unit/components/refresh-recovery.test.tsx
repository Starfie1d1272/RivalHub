import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/telemetry/ContentReady",()=>({ContentReady:()=>null}));
const mocks = vi.hoisted(() => ({ read: vi.fn(), count: vi.fn() }));
vi.mock("@/actions/predictions", () => ({ mutatePrediction: vi.fn() }));
vi.mock("@/lib/predictions/http-client", () => ({ fetchPredictionBoard: mocks.read, fetchPickEmSummary: vi.fn() }));
vi.mock("@/actions/online", () => ({ heartbeatOnline: mocks.count }));
vi.mock("@/lib/telemetry/client", async original => ({ ...await original<typeof import("@/lib/telemetry/client")>(), observeAction: (_name: string, fn: unknown) => fn, observeTask: (_name: string, fn: unknown) => fn }));
vi.mock("@/components/predictions/share-image", () => ({ exportPredictionImage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { PredictionBoard } from "@/components/predictions/PredictionBoard";
import { OnlineCounter } from "@/components/layout/OnlineCounter";
import { projectPredictionStages } from "@/lib/predictions/stage-projection";
import { MAJOR_STAGE_PLAN } from "@/lib/competition/templates";
import type { PickEmBoardData } from "@/lib/predictions/data";

function board(name: string): PickEmBoardData {
  const base = { version: 2, seasonId: "fixture", name, capturedAt: "2026-10-19T00:00:00Z", stages: projectPredictionStages(MAJOR_STAGE_PLAN), teams: [], runs: [], matches: [] };
  return { view: "sim", base, contexts: [{ kind: "major", baseline: base }], defaultContext: "major", enabled: true, joined: false, contests: [], achievement: null, pickLeaderboard: [], rules: { perfect: 1, advance: 7, eliminated: 1, swissTarget: 5, silver: 5, gold: 7, diamond: 9 } };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
afterEach(() => { vi.useRealTimers(); });
it("shows failed automatic refresh, retains data and recovers through the existing read button", async () => {
  const user = userEvent.setup();
  mocks.read.mockRejectedValueOnce(new Error("offline"));
  render(<PredictionBoard initial={board("上次赛况")} slug="fixture" signedIn={false} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText(/赛况更新失败/)).toBeVisible();
  expect(screen.getByText("上次赛况")).toBeVisible();
  mocks.read.mockResolvedValueOnce({ success: true, data: board("最新赛况") });
  vi.useRealTimers();
  await user.click(screen.getByRole("button", { name: "刷新赛况" }));
  await act(async () => {});
  expect(screen.getByText("最新赛况")).toBeVisible();
  expect(screen.queryByText(/赛况更新失败/)).toBeNull();
});
it("late automatic response cannot replace a newer explicit read", async () => {
  const user = userEvent.setup();
  let resolve!: (value: unknown) => void;
  mocks.read.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<PredictionBoard initial={board("初始赛况")} slug="fixture" signedIn={false} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  mocks.read.mockResolvedValueOnce({ success: true, data: board("新赛况") });
  vi.useRealTimers();
  await user.click(screen.getByRole("button", { name: "刷新赛况" }));
  await act(async () => resolve({ success: true, data: board("过期赛况") }));
  expect(screen.getByText("新赛况")).toBeVisible();
  expect(screen.queryByText("过期赛况")).toBeNull();
});
it("hides an unavailable online count and resumes on the next successful heartbeat", async () => {
  mocks.count.mockResolvedValueOnce({ count: 12, windowSeconds: 120, intervalMs: 60000 }).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ count: 9, windowSeconds: 120, intervalMs: 60000 });
  render(<OnlineCounter />);
  await act(async () => {});
  expect(screen.getByText(/12/)).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(screen.queryByText(/12/)).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(screen.getByText(/9/)).toBeVisible();
});
