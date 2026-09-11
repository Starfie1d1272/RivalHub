import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectionMock,
  getPublicOrAuthorizedDraftSeasonMock,
  getMajorPublicParticipantOverviewMock,
  getLatestSeasonAnnouncementMock,
  getPublicSeasonInfoMock,
  selectDistinctMock,
  selectMock,
} = vi.hoisted(() => ({
  connectionMock: vi.fn(),
  getPublicOrAuthorizedDraftSeasonMock: vi.fn(),
  getMajorPublicParticipantOverviewMock: vi.fn(),
  getLatestSeasonAnnouncementMock: vi.fn(),
  getPublicSeasonInfoMock: vi.fn(),
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
vi.mock("@/lib/participants/summary", () => ({ getParticipantSummary: vi.fn() }));
vi.mock("@/lib/major/public-participants", () => ({ getMajorPublicParticipantOverview: getMajorPublicParticipantOverviewMock }));
vi.mock("@/lib/announcements/read-model", () => ({ getLatestSeasonAnnouncement: getLatestSeasonAnnouncementMock }));
vi.mock("@/lib/season-public-info/read-model", () => ({ getPublicSeasonInfo: getPublicSeasonInfoMock }));

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
      registrationOpenedAt: null,
      stagePlan: [],
      competitionTemplate: "major",
      hasCaptainVoting: false,
      hasDraft: false,
    });
    getMajorPublicParticipantOverviewMock.mockResolvedValue({
      phase: "approved_candidates",
      presentation: {
        teamCollectionLabel: "已通过报名审核的队伍",
        teamCollectionDescription: "候选队伍",
        playerHeading: "已通过审核队伍选手",
        playerDescription: "正赛名单待确认",
      },
      entrantCapacity: 32,
      approvedCandidateCount: 0,
      officialEntrantCount: 0,
      teamCount: 0,
      playerCount: 0,
    });
    getLatestSeasonAnnouncementMock.mockResolvedValue(null);
    getPublicSeasonInfoMock.mockResolvedValue({ rules: { label: "赛事规则", href: "/rules" }, groups: [], contacts: [] });
    selectDistinctMock.mockReturnValue(chain([]));
    selectMock
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

  it.each([
    ["pre-open registration", "registration", null, false],
    ["open registration", "registration", new Date("2026-09-01T00:00:00.000Z"), true],
    ["finished season", "finished", new Date("2026-09-01T00:00:00.000Z"), false],
    ["archived season", "archived", new Date("2026-09-01T00:00:00.000Z"), false],
  ] as const)("shows the registration shortcut only for %s", async (_label, status, registrationOpenedAt, shouldShow) => {
    getPublicOrAuthorizedDraftSeasonMock.mockResolvedValue({
      id: "season-major",
      slug: "2026-nju-major",
      name: "2026 NJU Major",
      status,
      registrationMode: "team",
      registrationOpenedAt,
      stagePlan: [],
      competitionTemplate: "major",
      hasCaptainVoting: false,
      hasDraft: false,
    });

    const page = await SeasonPageContent({
      params: Promise.resolve({ seasonSlug: "2026-nju-major" }),
    });
    const html = renderToStaticMarkup(page);

    if (shouldShow) {
      expect(html).toMatch(/href="\/2026-nju-major\/register"[\s\S]*立即报名/);
    } else {
      expect(html).not.toContain("/2026-nju-major/register");
      expect(html).not.toContain("立即报名");
    }
  });
  it("renders compact season information entry when only rules exist without announcement, groups, or contacts", async () => {
    getLatestSeasonAnnouncementMock.mockResolvedValue(null);
    getPublicSeasonInfoMock.mockResolvedValue({
      rules: { label: "赛事规则", href: "/rules" },
      groups: [],
      contacts: [],
    });

    const page = await SeasonPageContent({
      params: Promise.resolve({ seasonSlug: "2026-nju-major" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("赛事信息");
    expect(html).toContain("赛事规则");
    expect(html).toContain('href="/2026-nju-major/info"');
    expect(html).not.toContain("最新公告");
  });
});