/** @vitest-environment jsdom */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserSessionMock,
  selectMock,
  readinessMock,
  redirectMock,
  profileFormMock,
} = vi.hoisted(() => ({
  getUserSessionMock: vi.fn(),
  selectMock: vi.fn(),
  readinessMock: vi.fn(),
  redirectMock: vi.fn(),
  profileFormMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getUserSession: getUserSessionMock }));
vi.mock("@/lib/my/readiness", () => ({ loadSettingsProfileReadiness: readinessMock }));
vi.mock("@/db/client", () => ({ db: { select: selectMock } }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/settings/ProfileForm", () => ({
  ProfileForm: (props: { current: unknown }) => {
    profileFormMock(props);
    return React.createElement("div", { "data-testid": "profile-form" });
  },
}));

import SettingsPage from "@/app/settings/page";

describe("SettingsPage Steam profile projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    getUserSessionMock.mockResolvedValue({ userId: "user-1" });
    readinessMock.mockResolvedValue({
      profile: { state: "ready", detail: "ready", cta: { href: "/settings", label: "查看" } },
      education: { state: "ready", detail: "ready", cta: { href: "/settings/education", label: "查看" } },
      competitiveProfiles: [],
      ready: true,
    });
    const query = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn().mockResolvedValue([{
        displayName: "展示昵称",
        perfectName: null,
        steam64: "76561198000000001",
        qq: null,
        liveStreamUrl: null,
        gameplayStyle: null,
        competitionHistory: null,
        steamProfile: {
          personaName: "Official Steam",
          profileUrl: "https://steamcommunity.com/profiles/76561198000000001",
          avatarUrl: null,
        },
      }]),
    };
    query.from.mockReturnValue(query);
    query.leftJoin.mockReturnValue(query);
    selectMock.mockReturnValue(query);
  });

  it("passes an official Steam profile through when its avatar is nullable", async () => {
    renderToStaticMarkup(await SettingsPage());

    expect(profileFormMock).toHaveBeenCalledOnce();
    expect(profileFormMock.mock.calls[0]?.[0]).toEqual({
      current: expect.objectContaining({
        steamProfile: {
          personaName: "Official Steam",
          profileUrl: "https://steamcommunity.com/profiles/76561198000000001",
          avatarUrl: null,
        },
      }),
    });
  });
});
