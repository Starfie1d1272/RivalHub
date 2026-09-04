/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MapPreferencesForm } from "@/components/settings/MapPreferencesForm";

const { saveMapPreferencesMock } = vi.hoisted(() => ({ saveMapPreferencesMock: vi.fn() }));

vi.mock("@/actions/competitive-profile", () => ({ saveMapPreferences: saveMapPreferencesMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => Object.assign(window.HTMLElement.prototype, {
  hasPointerCapture: () => false,
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
}));

describe("MapPreferencesForm", () => {
  beforeEach(() => {
    saveMapPreferencesMock.mockReset().mockResolvedValue({ success: true, data: undefined });
  });

  it("shows the current Active Duty separately and saves only sparse declared facts", async () => {
    const user = userEvent.setup();
    render(<MapPreferencesForm initialPreferences={[
      { map: "de_mirage", level: "none" },
      { map: "de_overpass", level: "strong" },
    ]} />);

    expect(screen.getByRole("heading", { name: "当前 Active Duty" })).toBeInTheDocument();
    expect(screen.getByText("Cache")).toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "展开其它地图（2）" });
    await user.click(expand);
    expect(screen.getByText("Overpass")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存地图熟练度" }));
    await waitFor(() => expect(saveMapPreferencesMock).toHaveBeenCalledWith({
      mapPreferences: [
        { map: "de_mirage", level: "none" },
        { map: "de_overpass", level: "strong" },
      ],
    }));
  });

  it("keeps a missing map visibly unfilled instead of assigning a level", () => {
    render(<MapPreferencesForm initialPreferences={[]} />);

    const cache = screen.getByText("Cache").closest("div.grid");
    expect(cache).not.toBeNull();
    expect(within(cache as HTMLElement).getByRole("button", { name: "未填写" })).toHaveAttribute("aria-pressed", "true");
    expect(within(cache as HTMLElement).getByRole("button", { name: "不会" })).toHaveAttribute("aria-pressed", "false");
  });
});
