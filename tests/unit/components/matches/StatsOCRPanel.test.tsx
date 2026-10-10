import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";

const actions = vi.hoisted(() => ({ getPlayerStatsByMap: vi.fn(), getMatchPlayerOptions: vi.fn(), savePlayerStats: vi.fn(), deletePlayerStatsByMap: vi.fn(), extractStatsFromScreenshot: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/actions/player-stats", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = { userId: "user", perfectName: "Demo Player", gameplayLocked: true, kills: 20, deaths: 10, assists: 5, hsPercent: 50, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, ratingPro: 1.2, rws: 7, we: 8 };

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
});

// The UI must preserve a server-classified failure and link its configuration
// advice. The provider tests own status mapping; this tests only the user flow.
describe("OCR failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.getPlayerStatsByMap.mockResolvedValue([]);
    actions.getMatchPlayerOptions.mockResolvedValue([]);
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
