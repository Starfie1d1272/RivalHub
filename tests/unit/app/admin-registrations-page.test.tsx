import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationRow } from "@/components/admin/RegistrationReviewList";

const {
  seasonFindFirstMock,
  selectMock,
  registrationReviewListMock,
} = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  selectMock: vi.fn(),
  registrationReviewListMock: vi.fn((props: { registrations: RegistrationRow[] }) => (
    <div data-testid="registration-review-list">{JSON.stringify(props.registrations)}</div>
  )),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
    },
    select: selectMock,
  },
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/components/admin/RegistrationReviewList", () => ({
  RegistrationReviewList: (props: { registrations: RegistrationRow[] }) =>
    registrationReviewListMock(props),
}));

vi.mock("@/components/admin/DraftRegistrationTable", () => ({
  DraftRegistrationTable: () => <div data-testid="draft-table" />,
}));

vi.mock("@/components/rivalhub", () => ({
  PageHeader: ({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) => <header><h1>{title}</h1>{description}</header>,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AdminRegistrationsPage from "@/app/admin/[seasonSlug]/registrations/page";

describe("AdminRegistrationsPage projection boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("normalizes valid steamProfileUrl and strips invalid legacy URLs to null before passing to RegistrationReviewList", async () => {
    seasonFindFirstMock.mockResolvedValue({
      id: "season-1",
      slug: "rivals-s1",
      name: "Rivals Season 1",
      status: "registration",
      teamRegistrationConfig: null,
      affiliationRules: null,
    });

    const mockRows = [
      {
        id: "reg-valid",
        status: "pending",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        email: "valid@example.com",
        steam64: "76561198000000001",
        steamProfileUrl: " https://steamcommunity.com/id/valid_player/?ref=steam#profile ",
      },
      {
        id: "reg-legacy-invalid",
        status: "pending",
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
        email: "legacy@example.com",
        steam64: "76561198000000002",
        steamProfileUrl: "https://steamcommunity.com/profiles/76561198000000002/edit",
      },
      {
        id: "reg-attacker-bypass",
        status: "pending",
        createdAt: new Date("2026-09-03T00:00:00.000Z"),
        email: "attacker@example.com",
        steam64: "76561198000000003",
        steamProfileUrl: "https://steamcommunity.com.attacker.example/id/evil",
      },
    ];

    // db.select().from(seasonRegistrations).leftJoin(users).where(...).orderBy(...)
    // db.select().from(registrationDrafts).where(...).orderBy(...)
    selectMock
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(mockRows),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    const page = await AdminRegistrationsPage({
      params: Promise.resolve({ seasonSlug: "rivals-s1" }),
    });
    renderToStaticMarkup(page);

    expect(registrationReviewListMock).toHaveBeenCalledTimes(1);
    const passedRegistrations: RegistrationRow[] =
      registrationReviewListMock.mock.calls[0][0].registrations;

    expect(passedRegistrations).toHaveLength(3);
    // Valid URL canonicalized
    expect(passedRegistrations[0].steamProfileUrl).toBe("https://steamcommunity.com/id/valid_player");
    // Invalid legacy URL normalized to null
    expect(passedRegistrations[1].steamProfileUrl).toBeNull();
    // Attacker CodeQL bypass URL normalized to null
    expect(passedRegistrations[2].steamProfileUrl).toBeNull();
  });
});
