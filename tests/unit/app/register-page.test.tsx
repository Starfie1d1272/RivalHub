import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  seasonFindFirstMock,
  registrationFindFirstMock,
  userFindFirstMock,
  selectMock,
  getPositionCountsMock,
  getApprovedCountMock,
  getUserSessionMock,
  registrationFormMock,
  registrationOpeningRecoveryMock,
  publicSeasonMock,
} = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  registrationFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  selectMock: vi.fn(),
  getPositionCountsMock: vi.fn(),
  getApprovedCountMock: vi.fn(),
  getUserSessionMock: vi.fn(),
  registrationFormMock: vi.fn(() => null),
  registrationOpeningRecoveryMock: vi.fn(() => null),
  publicSeasonMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      seasonRegistrations: { findFirst: registrationFindFirstMock },
      users: { findFirst: userFindFirstMock },
    },
    select: selectMock,
  },
}));

vi.mock("@/actions/register", () => ({
  getPositionCounts: getPositionCountsMock,
  getApprovedCount: getApprovedCountMock,
}));

vi.mock("@/lib/auth/session", () => ({ getUserSession: getUserSessionMock }));
vi.mock("@/lib/data/public-seasons", () => ({
  getPublicOrAuthorizedDraftSeason: publicSeasonMock,
  getPublicSeasonBySlug: vi.fn(),
}));

vi.mock("@/components/register/RegistrationForm", () => ({
  RegistrationForm: registrationFormMock,
}));
vi.mock("@/components/register/RegistrationOpeningRecovery", () => ({
  RegistrationOpeningRecovery: registrationOpeningRecoveryMock,
}));

import RegisterPage from "@/app/[seasonSlug]/register/page";

describe("team registration page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    publicSeasonMock.mockResolvedValue({
      id: "season-1",
      slug: "major",
      name: "RivalHub Major",
      status: "draft",
      registrationMode: "team",
    });
  });

  it("renders an unavailable state before season status or solo registration flow", async () => {
    const page = await RegisterPage({
      params: Promise.resolve({ seasonSlug: "major" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("报名尚未开放");
    expect(getUserSessionMock).not.toHaveBeenCalled();
    expect(getPositionCountsMock).not.toHaveBeenCalled();
    expect(getApprovedCountMock).not.toHaveBeenCalled();
    expect(registrationFindFirstMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(registrationFormMock).not.toHaveBeenCalled();
  });

  it("prefills a new solo registration from the current long-lived profile", async () => {
    publicSeasonMock.mockResolvedValue({
      id: "season-1",
      slug: "major",
      name: "RivalHub Major",
      status: "registration",
      registrationMode: "solo",
      registrationOpensAt: new Date("2026-01-01T00:00:00Z"),
      registrationOpenedAt: new Date("2026-01-01T00:00:00Z"),
      registrationClosesAt: null,
      rosterChangeClosesAt: null,
      registrationConfig: null,
      positions: ["opener", "closer", "anchor"],
    });
    getUserSessionMock.mockResolvedValue({ userId: "user-1", email: "player@example.com" });
    getPositionCountsMock.mockResolvedValue({ opener: 0, closer: 0, anchor: 0 });
    getApprovedCountMock.mockResolvedValue(0);
    registrationFindFirstMock.mockResolvedValue(null);
    userFindFirstMock.mockResolvedValue({
      studentId: "20260001",
      qq: "12345678",
      perfectName: "Perfect Player",
      steamName: "Steam Player",
      steam64: "76561198000000001",
      steamProfileUrl: "https://steamcommunity.com/id/player",
      gameplayStyle: "长期控图型",
      competitionHistory: "参加过校赛",
    });
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const page = await RegisterPage({ params: Promise.resolve({ seasonSlug: "major" }) });
    renderToStaticMarkup(page);

    const props = (registrationFormMock.mock.calls as unknown[][])[0]?.[0] as { initialValues?: Record<string, unknown> } | undefined;
    expect(props?.initialValues).toEqual(expect.objectContaining({
      gameplayStyle: "长期控图型",
      competitionHistory: "参加过校赛",
    }));
  });

  it("offers one-shot participant recovery when opening is due but not materialized", async () => {
    const now = Date.now();
    publicSeasonMock.mockResolvedValue({
      id: "season-1",
      slug: "major",
      name: "RivalHub Major",
      status: "registration",
      registrationMode: "solo",
      registrationOpensAt: new Date(now - 60_000),
      registrationOpenedAt: null,
      registrationClosesAt: new Date(now + 60_000),
      rosterChangeClosesAt: null,
      registrationConfig: null,
      positions: ["opener", "closer", "anchor"],
    });
    getUserSessionMock.mockResolvedValue({ userId: "user-1", email: "player@example.com" });

    const page = await RegisterPage({ params: Promise.resolve({ seasonSlug: "major" }) });
    renderToStaticMarkup(page);

    expect(registrationOpeningRecoveryMock).toHaveBeenCalledWith({ seasonId: "season-1" }, undefined);
  });
});
