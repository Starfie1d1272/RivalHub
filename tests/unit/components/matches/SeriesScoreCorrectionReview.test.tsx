import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapScoreCorrectInput } from "@/components/matches/MapScoreCorrectInput";
import { previewSeriesMapCorrection, confirmSeriesMapCorrection } from "@/actions/matches/series-correction";
import { correctMapScore } from "@/actions/matches";
import type { SeriesCorrectionPreview } from "@/lib/matches/series-score-correction";
vi.mock("@/actions/matches/series-correction", () => ({ previewSeriesMapCorrection: vi.fn(), confirmSeriesMapCorrection: vi.fn() }));
vi.mock("@/actions/matches", () => ({ correctMapScore: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const preview: SeriesCorrectionPreview = { revision: "a".repeat(64), currentA: 1, currentB: 1, scoreA: 2, scoreB: 0, correctedMapOrder: 2, oldA: 9, oldB: 13, newA: 13, newB: 9, maps: [{ order: 1, label: "已有正式结果" }, { order: 2, label: "已有正式结果" }, { order: 3, label: "未进行，更正后不再需要" }], downstreamCount: 0, postTasksExist: true, progressionLabel: "晋级结果将重新核算", blockers: [] };
const props = { matchId: "match", matchInProgress: true, mapId: "map", mapName: "de_mirage", scoreA: 9, scoreB: 13, teamAName: "Alpha", teamBName: "Beta" };
async function editAndPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "更正比分" }));
  await user.clear(screen.getByLabelText("Alpha更正比分")); await user.type(screen.getByLabelText("Alpha更正比分"), "13");
  await user.clear(screen.getByLabelText("Beta更正比分")); await user.type(screen.getByLabelText("Beta更正比分"), "9");
  await user.type(screen.getByLabelText("更正原因"), "核对 Perfect 最终比分");
  await user.click(screen.getByRole("button", { name: "核对更正" }));
}
describe("Workbench early-series recovery", () => {
  beforeEach(() => { vi.stubGlobal("React", React); vi.clearAllMocks(); vi.mocked(previewSeriesMapCorrection).mockResolvedValue({ success: true, data: preview }); vi.mocked(confirmSeriesMapCorrection).mockResolvedValue({ success: true, data: undefined }); });
  it("shows an explicit secondary recovery entry, previews impact and requires reason plus confirmation", async () => {
    const user = userEvent.setup(); render(<MapScoreCorrectInput {...props} />); await editAndPreview(user);
    await user.click(await screen.findByRole("button", { name: "进入系列赛果更正" }));
    expect(screen.getByText("当前：Alpha 1 : 1 Beta")).toBeInTheDocument(); expect(screen.getByText("更正后：Alpha 2 : 0 Beta")).toBeInTheDocument();
    expect(screen.getByText("比赛状态：进行中 → 已结束")).toBeInTheDocument(); expect(screen.getByText("Map 3：未进行，更正后不再需要")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "确认更正系列赛果" }); expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("整场更正原因"), "管理员复核"); expect(button).toBeDisabled();
    await user.click(screen.getByRole("checkbox")); await user.click(button);
    await waitFor(() => expect(confirmSeriesMapCorrection).toHaveBeenCalledOnce()); expect(correctMapScore).not.toHaveBeenCalled();
    expect(confirmSeriesMapCorrection).toHaveBeenCalledWith(expect.objectContaining({ previewRevision: preview.revision, reason: "管理员复核", confirmed: true, laterMapsNotStarted: true }));
  });
  it("shows started-map conflict without a confirmation action", async () => {
    vi.mocked(previewSeriesMapCorrection).mockResolvedValue({ success: true, data: { ...preview, blockers: ["Map 3 已开始，请先处理实际比赛事实。"] } });
    const user = userEvent.setup(); render(<MapScoreCorrectInput {...props} />); await editAndPreview(user); await user.click(await screen.findByRole("button", { name: "进入系列赛果更正" }));
    expect(screen.getByRole("alert")).toHaveTextContent("无法直接完成更正"); expect(screen.queryByRole("button", { name: "确认更正系列赛果" })).not.toBeInTheDocument();
  });
  it("refuses stale preview and requires starting a new review", async () => {
    vi.mocked(confirmSeriesMapCorrection).mockResolvedValue({ success: false, error: { code: "VALIDATION_FAILED", message: "比赛事实已变化，请重新预览后确认。" } });
    const user = userEvent.setup(); render(<MapScoreCorrectInput {...props} />); await editAndPreview(user); await user.click(await screen.findByRole("button", { name: "进入系列赛果更正" }));
    await user.type(screen.getByLabelText("整场更正原因"), "复核"); await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "确认更正系列赛果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("事实已变化"); expect(screen.getByRole("button", { name: "确认更正系列赛果" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "返回重新核对" })); expect(screen.queryByRole("region", { name: "更正系列赛果" })).not.toBeInTheDocument();
  });
  it("keeps ordinary non-finishing map corrections on their existing command", async () => {
    vi.mocked(previewSeriesMapCorrection).mockResolvedValue({ success: true, data: null }); vi.mocked(correctMapScore).mockResolvedValue({ success: true, data: undefined });
    const user = userEvent.setup(); render(<MapScoreCorrectInput {...props} />); await editAndPreview(user);
    await user.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => expect(correctMapScore).toHaveBeenCalledOnce()); expect(confirmSeriesMapCorrection).not.toHaveBeenCalled();
  });
});
