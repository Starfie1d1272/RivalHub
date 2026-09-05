import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { seasonFindFirstMock, loadPostEventMock, postEventMock, genericPostEventMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  loadPostEventMock: vi.fn(),
  postEventMock: vi.fn(() => <div data-testid="post-event" />),
  genericPostEventMock: vi.fn((props: { data: { season: { name: string } } }) => <div data-testid="generic-post-event">通用赛后摘要 · {props.data.season.name}</div>),
}));

vi.mock("@/db/client", () => ({ db: { query: { seasons: { findFirst: seasonFindFirstMock } } } }));
vi.mock("@/lib/admin/season-workspace/post-event", () => ({ loadPostEventPageData: loadPostEventMock }));
vi.mock("@/components/admin/PostEventManagement", () => ({ PostEventManagement: postEventMock }));
vi.mock("@/components/admin/SeasonPostEventOverview", () => ({ SeasonPostEventOverview: genericPostEventMock }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

import AdminSeasonPostEventPage from "@/app/admin/[seasonSlug]/post-event/page";

describe("AdminSeasonPostEventPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("loads the post-event read model only on the post-event route", async () => {
    const season = { id: "season-1", slug: "nju-major-2026", name: "NJU Major 2026", status: "finished", competitionTemplate: "major" } as const;
    seasonFindFirstMock.mockResolvedValue(season);
    loadPostEventMock.mockResolvedValue({ season, data: { seasonId: season.id, seasonStatus: season.status, competitionTemplate: season.competitionTemplate, matchCount: 0, honorCount: 0, activeAdjudicationCount: 0, finalResult: null, teams: [], honors: [], adjudications: [] } });

    const html = renderToStaticMarkup(await AdminSeasonPostEventPage({ params: Promise.resolve({ seasonSlug: season.slug }) }));

    expect(loadPostEventMock).toHaveBeenCalledWith(season);
    expect(postEventMock).toHaveBeenCalled();
    expect(html).toContain("赛后 · NJU Major 2026");
  });

  it("uses the generic closure presentation for non-Major templates", async () => {
    const season = { id: "season-2", slug: "rivals-s1", name: "Rivals S1", status: "finished", competitionTemplate: "rivals" } as const;
    seasonFindFirstMock.mockResolvedValue(season);
    loadPostEventMock.mockResolvedValue({ season, data: { seasonId: season.id, seasonStatus: season.status, competitionTemplate: season.competitionTemplate, matchCount: 12, honorCount: 2, activeAdjudicationCount: 1, finalResult: null, teams: [], honors: [], adjudications: [] } });

    const html = renderToStaticMarkup(await AdminSeasonPostEventPage({ params: Promise.resolve({ seasonSlug: season.slug }) }));

    expect(genericPostEventMock).toHaveBeenCalled();
    expect(postEventMock).not.toHaveBeenCalled();
    expect(html).toContain("通用赛后摘要");
    expect(html).not.toContain("最终结果 · 确认");
  });
});
