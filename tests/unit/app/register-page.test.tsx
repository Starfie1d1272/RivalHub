import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  seasonFindFirstMock,
  registrationFindFirstMock,
  userFindFirstMock,
  getPositionCountsMock,
  getApprovedCountMock,
  getUserSessionMock,
  registrationFormMock,
  publicSeasonMock,
} = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  registrationFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  getPositionCountsMock: vi.fn(),
  getApprovedCountMock: vi.fn(),
  getUserSessionMock: vi.fn(),
  registrationFormMock: vi.fn(() => null),
  publicSeasonMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      seasonRegistrations: { findFirst: registrationFindFirstMock },
      users: { findFirst: userFindFirstMock },
    },
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
});
