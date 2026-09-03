import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectionMock,
  getPublicOrAuthorizedDraftSeasonMock,
  getParticipantSummaryMock,
  selectDistinctMock,
  selectMock,
} = vi.hoisted(() => ({
  connectionMock: vi.fn(),
  getPublicOrAuthorizedDraftSeasonMock: vi.fn(),
  getParticipantSummaryMock: vi.fn(),
  selectDistinctMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: connectionMock }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/components/layout/AdminShortcutSlot", () => ({ AdminShortcutSlot: () => null }));
vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    selectDistinct: selectDistinctMock,
  },
}));
vi.mock("@/lib/data/public-seasons", () => ({
  getPublicOrAuthorizedDraftSeason: getPublicOrAuthorizedDraftSeasonMock,
}));
vi.mock("@/lib/participants/summary", () => ({ getParticipantSummary: getParticipantSummaryMock }));

import { SeasonPageContent } from "@/app/[seasonSlug]/page";

function chain<T>(value: T) {
  const result = {
    from: () => result,
    where: () => result,
    then: (resolve: (resolved: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

describe("season page navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    connectionMock.mockResolvedValue(undefined);
    getPublicOrAuthorizedDraftSeasonMock.mockResolvedValue({
      id: "season-major",
      slug: "2026-nju-major",
      name: "2026 NJU Major",
      status: "registration",
      registrationMode: "team",
      stagePlan: [],
      competitionTemplate: "major",
      hasCaptainVoting: false,
      hasDraft: false,
    });
    getParticipantSummaryMock.mockResolvedValue({ count: 0, hasPlayers: false });
    selectDistinctMock.mockReturnValue(chain([]));
    selectMock
      .mockImplementationOnce(() => chain([{ value: 4 }]))
      .mockImplementationOnce(() => chain([{ total: 0, finished: 0 }]));
  });

  it("routes the visible team roster shortcut to the canonical teams page", async () => {
    const page = await SeasonPageContent({
      params: Promise.resolve({ seasonSlug: "2026-nju-major" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toMatch(/href="\/2026-nju-major\/teams"[\s\S]*队伍阵容/);
    expect(html).not.toContain("/competitionEntries");
  });
});
