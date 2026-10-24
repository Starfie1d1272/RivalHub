import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), options: vi.fn(), receipt: vi.fn(), save: vi.fn(), clear: vi.fn(), extract: vi.fn(), refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/actions/player-stats", () => ({ getOperatorScoreboardSnapshot: mocks.read, getScoreboardEditorState: mocks.options, getScoreboardOperationReceipt: mocks.receipt,
  retryPlayerStatsRefresh: mocks.invalidate, savePlayerStats: mocks.save, deletePlayerStatsByMap: mocks.clear, extractStatsFromScreenshot: mocks.extract }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";

const saved = { perfectName: "Retained player", userId: "00000000-0000-4000-8000-000000000001", kills: 20, deaths: 10, assists: 5,
  hsPercent: 30, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, rws: 10, ratingPro: 1.2, we: 8, gameplayLocked: true };
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.invalidate.mockResolvedValue({ success: true });
  mocks.options.mockResolvedValue({ success: true, data: { snapshot: { rows: [saved], version: "a".repeat(64), actorScope: saved.userId }, playerOptions: [{ userId: saved.userId, perfectName: saved.perfectName }] } });
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

it("does not overwrite an explicitly recovered edit with a late initial prop snapshot", async () => {
  mocks.read.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "unavailable" } })
    .mockResolvedValueOnce({ success: true, data: { rows: [saved], version: "a".repeat(64), actorScope: saved.userId } });
  const user = userEvent.setup();
  const { rerender } = render(<StatsOCRPanel mapId="map" mapName="de_mirage" />);
  await screen.findByText("无法读取已保存数据。");
  await user.click(screen.getByRole("button", { name: "载入当前已保存数据（替换草稿）" }));
  await user.click(await screen.findByRole("button", { name: "重新录入" }));
  const rating = await screen.findByLabelText("Retained player Rating");
  await user.clear(rating);
  await user.type(rating, "1.4");
  rerender(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[{ ...saved, ratingPro: 9 }]} />);
  expect(rating).toHaveValue(1.4);
  expect(screen.getByRole("button", { name: "确认保存" })).toBeVisible();
});

it("keeps the draft after an unknown save and exits busy without replay", async () => {
  mocks.save.mockRejectedValue(new TypeError("connection lost"));
  const user = userEvent.setup();
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(screen.getByRole("button", { name: "重新录入" }));
  await user.click(await screen.findByRole("button", { name: "确认保存" }));
  expect(await screen.findByText("提交结果待核对；当前草稿和操作编号已保留。")).toBeTruthy();
  const save = screen.getByRole("button", { name: "确认保存" });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Retained player K")).toHaveValue(20);
});

it("retains a committed draft when refresh fails, then permits an explicit authorized reload", async () => {
  mocks.save.mockResolvedValue({ success: true, data: { saved: 1, refreshPending: false } });
  mocks.read.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "unavailable" } })
    .mockResolvedValueOnce({ success: true, data: { rows: [saved], version: "a".repeat(64), actorScope: saved.userId } });
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


it("keeps the original unknown command blocked until its durable receipt is confirmed", async () => {
  mocks.save.mockRejectedValue(new TypeError("lost commit acknowledgement"));
  mocks.receipt.mockResolvedValueOnce({ success: true, data: { status: "unconfirmed" } })
    .mockResolvedValueOnce({ success: true, data: { status: "committed", snapshot: { rows: [{ ...saved, ratingPro: 2 }], version: "b".repeat(64), actorScope: saved.userId }, superseded: true } });
  const user = userEvent.setup();
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(screen.getByRole("button", { name: "重新录入" }));
  await user.click(await screen.findByRole("button", { name: "确认保存" }));
  const original = mocks.save.mock.calls[0][1];
  await user.click(await screen.findByRole("button", { name: "核对原操作提交凭据" }));
  expect(await screen.findByText(/尚未找到原请求的提交凭据/)).toBeVisible();
  expect(screen.getByRole("button", { name: "确认保存" })).toBeDisabled();
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.receipt).toHaveBeenLastCalledWith("map", original);
  await user.click(screen.getByRole("button", { name: "核对原操作提交凭据" }));
  expect(await screen.findByText(/原提交已确认，但已有后续更改/)).toBeVisible();
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "重新录入" })).toBeEnabled();
});

it("loads the authorized roster and current version before manually adding to a prefetched empty board", async () => {
  const user = userEvent.setup();
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[]} initialVersion={"a".repeat(64)} />);
  await user.click(screen.getByRole("button", { name: "添加行" }));
  expect(await screen.findByLabelText("Retained player K")).toHaveValue(20);
  expect(mocks.options).toHaveBeenCalledOnce();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("recovers an original operation after unmount without persisting private draft contents", async () => {
  mocks.save.mockRejectedValue(new TypeError("response lost"));
  const user = userEvent.setup();
  const first = render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(screen.getByRole("button", { name: "重新录入" }));
  await user.click(await screen.findByRole("button", { name: "确认保存" }));
  await screen.findByText("提交结果待核对；当前草稿和操作编号已保留。");
  const command = mocks.save.mock.calls[0][1];
  const persisted = Object.values(localStorage).join("");
  expect(persisted).toContain(command.operationId);
  expect(persisted).not.toContain(saved.perfectName);
  expect(persisted).not.toContain("ratingPro");
  expect(persisted).not.toContain('"rows"');
  first.unmount();
  mocks.read.mockResolvedValue({ success: true, data: { rows: [saved], version: "b".repeat(64), actorScope: saved.userId } });
  mocks.receipt.mockResolvedValue({ success: true, data: { status: "committed", snapshot: { rows: [saved], version: "b".repeat(64), actorScope: saved.userId }, superseded: false } });
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await screen.findByText(/已恢复原操作编号/);
  await user.click(screen.getByRole("button", { name: "核对原操作提交凭据" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "核对原操作提交凭据" })).toBeNull());
  expect(mocks.receipt).toHaveBeenCalledWith("map", expect.objectContaining({ operationId: command.operationId, expectedVersion: command.expectedVersion, operation: "save" }));
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(0);
});


it("releases busy ownership after an in-flight recovery is superseded by initial props", async () => {
  let finishRead!: (result: unknown) => void;
  mocks.read.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "unavailable" } })
    .mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  const user = userEvent.setup();
  const { rerender } = render(<StatsOCRPanel mapId="map" mapName="de_mirage" />);
  await screen.findByText("无法读取已保存数据。");
  await user.click(screen.getByRole("button", { name: "载入当前已保存数据（替换草稿）" }));
  rerender(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  const edit = await screen.findByRole("button", { name: "重新录入" });
  expect(edit).toBeDisabled();
  await act(async () => finishRead({ success: true, data: { rows: [{ ...saved, ratingPro: 9 }], version: "b".repeat(64), actorScope: saved.userId } }));
  await waitFor(() => expect(edit).toBeEnabled());
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not restore another actor's persisted operation", async () => {
  const { rememberScoreboardOperation } = await import("@/lib/ocr/scoreboard-recovery");
  rememberScoreboardOperation({ mapId: "map", actorScope: "00000000-0000-4000-8000-000000000099", operationId: crypto.randomUUID(), operation: "clear", expectedVersion: "a".repeat(64) });
  mocks.read.mockResolvedValue({ success: true, data: { rows: [saved], version: "b".repeat(64), actorScope: saved.userId } });
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "核对原操作提交凭据" })).toBeNull();
  expect(mocks.receipt).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(1);
});

it("does not send a write if its non-sensitive recovery locator cannot be persisted", async () => {
  const user = userEvent.setup();
  render(<StatsOCRPanel mapId="map" mapName="de_mirage" initialRows={[saved]} />);
  await user.click(screen.getByRole("button", { name: "重新录入" }));
  const unavailable = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
  try {
    await user.click(await screen.findByRole("button", { name: "确认保存" }));
    expect(await screen.findByText(/操作恢复编号无法保存/)).toBeVisible();
    expect(mocks.save).not.toHaveBeenCalled();
  } finally { unavailable.mockRestore(); }
});
