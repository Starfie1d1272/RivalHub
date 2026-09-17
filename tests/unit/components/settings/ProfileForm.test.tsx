/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupSteamProfileMock, updateProfileMock } = vi.hoisted(() => ({
  lookupSteamProfileMock: vi.fn(),
  updateProfileMock: vi.fn(),
}));

vi.mock("@/actions/account", () => ({
  lookupSteamProfile: lookupSteamProfileMock,
  updateProfile: updateProfileMock,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProfileForm } from "@/components/settings/ProfileForm";

describe("ProfileForm Steam profile card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("renders the cached official profile when avatarUrl is null", () => {
    render(<ProfileForm current={{
      displayName: "展示昵称",
      perfectName: null,
      steam64: "76561198000000001",
      steamProfile: {
        personaName: "Official Steam",
        profileUrl: "https://steamcommunity.com/profiles/76561198000000001",
        avatarUrl: null,
      },
      qq: null,
      liveStreamUrl: null,
      gameplayStyle: null,
      competitionHistory: null,
    }} />);

    expect(screen.getByText("Official Steam")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 Steam 个人资料" })).toHaveAttribute(
      "href",
      "https://steamcommunity.com/profiles/76561198000000001",
    );
  });
});
