import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
const actions = vi.hoisted(() => ({ getPlayerStatsByMap: vi.fn(), getMatchPlayerOptions: vi.fn(), savePlayerStats: vi.fn(), deletePlayerStatsByMap: vi.fn(), extractStatsFromScreenshot: vi.fn() }));
vi.mock("@/actions/player-stats", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const row = { userId: "user", perfectName: "Demo Player", dakImportId: "demo", kills: 20, deaths: 10, assists: 5, hsPercent: 50, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, ratingPro: 1.2, rws: 7, we: 8 };

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
    actions.getPlayerStatsByMap.mockResolvedValue([{ ...row, dakImportId: null }]);
    render(<StatsOCRPanel mapId="map" mapName="Nuke" />);
    fireEvent.click(await screen.findByRole("button", { name: "重新录入" }));
    await waitFor(() => expect(screen.getByLabelText("Demo Player K")).toBeEnabled());
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
});
