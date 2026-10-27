import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlayInRoundControl } from "@/components/admin/PlayInRoundControl";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), generate: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("@/actions/competition-qualification", () => ({ previewCompetitionQualificationRound: mocks.preview, generateCompetitionQualificationRound: mocks.generate }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows server rejection for unfinished matches and generates only after preview confirmation", async () => {
  mocks.preview.mockResolvedValueOnce({ success: false, error: { message: "当前轮次尚未全部完成" } }).mockResolvedValueOnce({ success: true, data: { round: 2, format: "bo1", matchups: [{ higherSeedTeamId: "a", higherSeedTeamName: "A", higherSeed: 1, lowerSeedTeamId: "b", lowerSeedTeamName: "B", lowerSeed: 2 }] } });
  mocks.generate.mockResolvedValue({ success: true, data: { round: 2, created: true } });
  render(<PlayInRoundControl seasonId="season" runId="run" />);
  fireEvent.click(screen.getByRole("button", { name: "预览 Play-in 下一轮" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("当前轮次尚未全部完成"));
  expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览 Play-in 下一轮" }));
  await screen.findByRole("dialog", { name: "第 2 轮对阵预览" });
  expect(mocks.generate).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "确认并生成对阵" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认并生成对阵" }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith({ seasonId: "season", runId: "run", expectedPairings: [{ higherSeedTeamId: "a", lowerSeedTeamId: "b" }] }));
});
