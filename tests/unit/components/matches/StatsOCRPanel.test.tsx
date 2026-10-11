import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";

const actions = vi.hoisted(() => ({ getPlayerStatsByMap: vi.fn(), getMatchPlayerOptions: vi.fn(), savePlayerStats: vi.fn(), deletePlayerStatsByMap: vi.fn(), extractStatsFromScreenshot: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/actions/player-stats", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = { userId: "user", perfectName: "Demo Player", gameplayLocked: true, kills: 20, deaths: 10, assists: 5, hsPercent: 50, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, ratingPro: 1.2, rws: 7, we: 8 };

beforeAll(() => Object.assign(window.HTMLElement.prototype, { hasPointerCapture: () => false, releasePointerCapture: () => {}, scrollIntoView: () => {} }));

describe("operator scoreboard editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.getPlayerStatsByMap.mockResolvedValue([row]);
    actions.getMatchPlayerOptions.mockResolvedValue([{ userId: "user", perfectName: "Demo Player" }]);
  });

  it("locks Demo gameplay and identity while keeping Rating/RWS/WE editable", async () => {
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    fireEvent.click(await screen.findByRole("button", { name: "重新录入" }));
    await waitFor(() => expect(screen.getByLabelText("Demo Player K")).toBeDisabled());
    for (const label of ["K", "D", "A", "HS%", "FK", "MK", "残局", "ADR"]) expect(screen.getByLabelText(`Demo Player ${label}`)).toBeDisabled();
    for (const label of ["Rating", "RWS", "WE"]) expect(screen.getByLabelText(`Demo Player ${label}`)).toBeEnabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByTitle("删除此行")).toBeDisabled();
  });

  it("keeps OCR-only gameplay editable", async () => {
    actions.getPlayerStatsByMap.mockResolvedValue([{ ...row, gameplayLocked: false }]);
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    fireEvent.click(await screen.findByRole("button", { name: "重新录入" }));
    await waitFor(() => expect(screen.getByLabelText("Demo Player K")).toBeEnabled());
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  it("refreshes the parent task after saving platform fields", async () => {
    actions.savePlayerStats.mockResolvedValue({ success: true });
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    fireEvent.click(await screen.findByRole("button", { name: "重新录入" }));
    fireEvent.click(await screen.findByRole("button", { name: /保存/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("refreshes the parent task after clearing platform fields", async () => {
    actions.deletePlayerStatsByMap.mockResolvedValue({ success: true });
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    fireEvent.click(await screen.findByRole("button", { name: /清除/ }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("merges three unresolved screenshot rows into occupied Demo players and discards cancelled edits", async () => {
    const user = userEvent.setup();
    const saved = Array.from({ length: 10 }, (_, i) => ({ ...row, userId: `u${i}`, perfectName: `队伍很长的名称 选手${i}`, ratingPro: null, rws: null, we: null }));
    const options = saved.map(p => ({ userId: p.userId, perfectName: p.perfectName }));
    actions.getPlayerStatsByMap.mockResolvedValue(saved);
    actions.getMatchPlayerOptions.mockResolvedValue(options);
    actions.extractStatsFromScreenshot.mockResolvedValue({ success: true, data: { playerOptions: options, drafts: saved.map((p, i) => ({ ...p, gameplayLocked: undefined, userId: i < 7 ? p.userId : null, perfectName: `截图选手${i}`, ratingPro: 1.5, rws: 12, we: 9, kills: 999 })) } });
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    expect(await screen.findByRole("button", { name: "补传计分板截图" })).toBeEnabled();
    await user.upload(screen.getByLabelText("记分板截图"), new File(["image"], "截图.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "OCR 识别截图" }));
    expect(await screen.findAllByRole("combobox")).toHaveLength(13);
    for (let i = 7; i < 10; i++) {
      await user.click(screen.getAllByRole("combobox")[7]!);
      await user.click(await screen.findByRole("option", { name: new RegExp(`选手${i}（合并截图指标）`) }));
    }
    expect(screen.getAllByRole("combobox")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "确认保存" })).toBeEnabled();
    expect(screen.getByLabelText(`${saved[7]!.perfectName} K`)).toHaveValue(20);
    expect(screen.getByLabelText(`${saved[7]!.perfectName} Rating`)).toHaveValue(1.5);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(actions.savePlayerStats).not.toHaveBeenCalled();
    expect(actions.deletePlayerStatsByMap).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "重新录入" }));
    expect(screen.getByLabelText(`${saved[7]!.perfectName} Rating`)).toHaveValue(null);
  });
});

// The UI must preserve a server-classified failure and link its configuration
// advice. The provider tests own status mapping; this tests only the user flow.
describe("OCR failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.getPlayerStatsByMap.mockResolvedValue([]);
    actions.getMatchPlayerOptions.mockResolvedValue([]);
  });

  it("offers keyboard selection, preserves a cancelled selection and restores replacement after errors", async () => {
    const user = userEvent.setup();
    actions.extractStatsFromScreenshot.mockResolvedValue({ success: false, error: { code: "OCR_UNAVAILABLE", message: "识别暂不可用" } });
    render(<StatsOCRPanel mapId="map" mapName="Cache" />);
    const input = await screen.findByLabelText("记分板截图");
    const choose = screen.getByRole("button", { name: "选择截图" });
    expect(screen.getByRole("button", { name: "OCR 识别截图" })).toBeDisabled();
    const open = vi.spyOn(input, "click");
    choose.focus();
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledOnce();
    await user.upload(input, new File(["first"], "第一张.png", { type: "image/png" }));
    expect(screen.getByText("第一张.png")).toBeVisible();
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.getByText("第一张.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "OCR 识别截图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("识别暂不可用");
    await user.upload(input, new File(["second"], "第二张.png", { type: "image/png" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("第二张.png")).toBeVisible();
    expect(screen.getByRole("button", { name: "OCR 识别截图" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "OCR 识别截图" }));
    await waitFor(() => expect(actions.extractStatsFromScreenshot).toHaveBeenCalledTimes(2));
    expect(actions.extractStatsFromScreenshot.mock.calls[1][0].base64Image).toBe("c2Vjb25k");
  });

  it("shows the 401 reason, reference and configuration entry after reading a PNG", async () => {
    const user = userEvent.setup();
    const requestId = "10000000-0000-4000-8000-000000000001";
    actions.extractStatsFromScreenshot.mockResolvedValue({ success: false, error: { code: "OCR_UNAVAILABLE", message: "OCR 上游鉴权失败，请联系超级管理员检查环境绑定、凭据和上游账号权限。（HTTP 401）", meta: { requestId, configurationRequired: true } } });
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    const input = await screen.findByLabelText("记分板截图");
    await user.upload(input, new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "fixture.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: "OCR 识别截图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("鉴权失败");
    expect(screen.getByRole("alert")).toHaveTextContent(`排查编号：${requestId}`);
    expect(screen.getByRole("link", { name: /OCR 配置检查指引/ })).toHaveAttribute("href", "/admin/settings#ocr-configuration");
    expect(actions.extractStatsFromScreenshot).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png", base64Image: "iVBORw0KGgo=" }));
    expect(screen.getByRole("alert")).not.toHaveTextContent("截图格式");
  });

  it("offers network recovery without displaying raw client exceptions", async () => {
    const user = userEvent.setup();
    actions.extractStatsFromScreenshot.mockRejectedValue(new Error("private transport payload"));
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    await user.upload(await screen.findByLabelText("记分板截图"), new File(["fixture"], "fixture.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: "OCR 识别截图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("检查网络连接");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private transport");
    expect(screen.queryByRole("link", { name: /OCR 配置检查指引/ })).not.toBeInTheDocument();
  });
});
