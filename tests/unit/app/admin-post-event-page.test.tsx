import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { seasonFindFirstMock, loadPostEventMock, postEventMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  loadPostEventMock: vi.fn(),
  postEventMock: vi.fn(() => <div data-testid="post-event" />),
}));

vi.mock("@/db/client", () => ({ db: { query: { seasons: { findFirst: seasonFindFirstMock } } } }));
vi.mock("@/lib/admin/season-workspace", () => ({ loadPostEventPageData: loadPostEventMock }));
vi.mock("@/components/admin/PostEventManagement", () => ({ PostEventManagement: postEventMock }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

import AdminSeasonPostEventPage from "@/app/admin/[seasonSlug]/post-event/page";

describe("AdminSeasonPostEventPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("loads the post-event read model only on the post-event route", async () => {
    const season = { id: "season-1", slug: "nju-major-2026", name: "NJU Major 2026", status: "finished" };
    seasonFindFirstMock.mockResolvedValue(season);
    loadPostEventMock.mockResolvedValue({ season, data: { seasonId: season.id, seasonStatus: season.status, finalResult: null, teams: [], honors: [], adjudications: [] } });

    const html = renderToStaticMarkup(await AdminSeasonPostEventPage({ params: Promise.resolve({ seasonSlug: season.slug }) }));

    expect(loadPostEventMock).toHaveBeenCalledWith(season);
    expect(postEventMock).toHaveBeenCalled();
    expect(html).toContain("赛后 · NJU Major 2026");
  });
});
