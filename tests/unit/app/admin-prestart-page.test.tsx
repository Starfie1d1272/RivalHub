import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { seasonFindFirstMock, loadMajorPrestartMock, majorConsoleMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  loadMajorPrestartMock: vi.fn(),
  majorConsoleMock: vi.fn((props: { seasonName: string }) => <div data-testid="major-prestart">{props.seasonName}</div>),
}));

vi.mock("@/db/client", () => ({ db: { query: { seasons: { findFirst: seasonFindFirstMock } } } }));
vi.mock("@/lib/admin/season-workspace", () => ({ loadMajorPrestartPageData: loadMajorPrestartMock }));
vi.mock("@/components/admin/MajorPrestartConsole", () => ({ MajorPrestartConsole: majorConsoleMock }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

import AdminSeasonPrestartPage from "@/app/admin/[seasonSlug]/prestart/page";

describe("AdminSeasonPrestartPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("routes Major-only prestart read-model data to the existing console", async () => {
    const season = {
      id: "season-1",
      slug: "nju-major-2026",
      name: "NJU Major 2026",
      competitionTemplate: "major",
      hasCaptainVoting: false,
      hasDraft: false,
      stagePlan: [],
    };
    seasonFindFirstMock.mockResolvedValue(season);
    loadMajorPrestartMock.mockResolvedValue({ season, readiness: {}, management: {}, seedManagement: {}, started: false });

    const html = renderToStaticMarkup(await AdminSeasonPrestartPage({ params: Promise.resolve({ seasonSlug: season.slug }) }));

    expect(loadMajorPrestartMock).toHaveBeenCalledWith(season);
    expect(html).toContain("NJU Major 2026");
  });

  it("uses capability links for non-Major prestart routes", async () => {
    seasonFindFirstMock.mockResolvedValue({
      id: "season-2",
      slug: "rivals-s1",
      name: "Rivals S1",
      competitionTemplate: "rivals",
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: [],
    });

    const html = renderToStaticMarkup(await AdminSeasonPrestartPage({ params: Promise.resolve({ seasonSlug: "rivals-s1" }) }));

    expect(loadMajorPrestartMock).not.toHaveBeenCalled();
    expect(html).toContain('href="/admin/rivals-s1/captains"');
    expect(html).toContain('href="/admin/rivals-s1/draft"');
  });
});
