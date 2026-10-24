import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), options: vi.fn(), save: vi.fn(), clear: vi.fn(), extract: vi.fn(), refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/actions/player-stats", () => ({ getPlayerStatsByMap: mocks.read, getMatchPlayerOptions: mocks.options,
  retryPlayerStatsRefresh: mocks.invalidate, savePlayerStats: mocks.save, deletePlayerStatsByMap: mocks.clear, extractStatsFromScreenshot: mocks.extract }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";

const saved = { perfectName: "Retained player", userId: "00000000-0000-4000-8000-000000000001", kills: 20, deaths: 10, assists: 5,
  hsPercent: 30, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, rws: 10, ratingPro: 1.2, we: 8, gameplayLocked: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invalidate.mockResolvedValue({ success: true });
  mocks.options.mockResolvedValue({ success: true, data: [{ userId: saved.userId, perfectName: saved.perfectName }] });
});

// Protect the user-visible write/refresh boundary; DB ownership is covered in real PG.
it("uses an explicitly empty initial snapshot without a mount read", () => {
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[]} />);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.queryByText("加载中…")).toBeNull();
});

it("adopts a late initial snapshot once without leaving loading stuck or replacing later edits", async () => {
  mocks.read.mockReturnValue(new Promise(() => {}));
  const user = userEvent.setup();
  const { rerender } = render(<StatsOCRPanel mapId="map" mapName="de_mirage" />);
  rerender(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(await screen.findByRole("button", { name: "重新录入" }));
  const rating = await screen.findByLabelText("Retained player Rating");
  await user.clear(rating);
  await user.type(rating, "1.4");
  rerender(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[{ ...saved, ratingPro: 9 }]} />);
  expect(rating).toHaveValue(1.4);
  expect(mocks.read).toHaveBeenCalledOnce();
});

it("does not treat a failed initial read as an empty editable scoreboard", async () => {
  mocks.read.mockResolvedValue({ success: false, error: { code: "FORBIDDEN", message: "读取失败" } });
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" />);
  expect(await screen.findByText("无法读取已保存数据。")).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "OCR 识别截图" })).toBeDisabled();
});

it("keeps the draft after an unknown save and exits busy without replay", async () => {
  mocks.save.mockRejectedValue(new TypeError("connection lost"));
  const user = userEvent.setup();
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(screen.getByRole("button", { name: "重新录入" }));
  await user.click(await screen.findByRole("button", { name: "确认保存" }));
  expect(await screen.findByText("提交结果待核对；当前草稿已保留。")).toBeTruthy();
  const save = screen.getByRole("button", { name: "确认保存" });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Retained player K")).toHaveValue(20);
});

it("retains a committed draft when refresh fails, then permits an explicit authorized reload", async () => {
  mocks.save.mockResolvedValue({ success: true, data: { saved: 1, refreshPending: false } });
  mocks.read.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "unavailable" } })
    .mockResolvedValueOnce({ success: true, data: [saved] });
  const user = userEvent.setup();
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(screen.getByRole("button", { name: "重新录入" }));
  await user.click(await screen.findByRole("button", { name: "确认保存" }));
  expect(await screen.findByText("写入已确认，刷新待完成。")).toBeTruthy();
  expect(screen.getByLabelText("Retained player K")).toHaveValue(20);
  await user.click(screen.getByRole("button", { name: "载入当前已保存数据（替换草稿）" }));
  await waitFor(() => expect(screen.queryByText("写入已确认，刷新待完成。")).toBeNull());
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "重新录入" })).toBeEnabled();
});
