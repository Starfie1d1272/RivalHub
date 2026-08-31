import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkAdminSessionMock, redirectMock, selectMock } = vi.hoisted(() => ({
  checkAdminSessionMock: vi.fn(),
  redirectMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  checkAdminSession: checkAdminSessionMock,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));
vi.mock("@/db/client", () => ({ db: { select: selectMock } }));

import AdminDashboardPage from "@/app/admin/page";

const seasonId = "00000000-0000-0000-0000-000000000001";

function makeSeason(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: seasonId,
    slug: "nju-major-2026",
    name: "NJU Major 2026",
    status: "playing",
    hasDraft: true,
    hasCaptainVoting: true,
    ...overrides,
  };
}

function mockSeasonRows(rows: unknown[]) {
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({ orderBy: async () => rows }),
      orderBy: async () => rows,
    }),
  }));
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await AdminDashboardPage());
}

describe("admin dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("redirects unauthenticated requests without reading admin.role", async () => {
    checkAdminSessionMock.mockResolvedValue(null);

    await expect(AdminDashboardPage()).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("routes season name and console CTA to the season console, not matches", async () => {
    checkAdminSessionMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason()]);

    const html = await renderPage();

    expect(html).toMatch(/href="\/admin\/nju-major-2026"><div><span[^>]*>NJU Major 2026<\/span>/);
    expect(html).toContain('href="/admin/nju-major-2026">赛事控制台');
  });

  it("keeps matches / registrations / draft / captains as secondary shortcuts for an active season", async () => {
    checkAdminSessionMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason()]);

    const html = await renderPage();

    expect(html).toContain('href="/admin/nju-major-2026/matches"');
    expect(html).toContain('href="/admin/nju-major-2026/registrations"');
    expect(html).toContain('href="/admin/nju-major-2026/draft"');
    expect(html).toContain('href="/admin/nju-major-2026/captains"');
    expect(html).toContain('href="/admin/nju-major-2026/settings"');
  });

  it("hides draft / captains shortcuts when the season capabilities are off", async () => {
    checkAdminSessionMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason({ hasDraft: false, hasCaptainVoting: false })]);

    const html = await renderPage();

    expect(html).not.toContain("选秀");
    expect(html).not.toContain("队长投票");
  });

  it("keeps the console entry for a finished season without active-stage shortcuts", async () => {
    checkAdminSessionMock.mockResolvedValue({
      role: "super_admin",
      seasonIds: [],
    });
    mockSeasonRows([makeSeason({ status: "finished" })]);

    const html = await renderPage();

    expect(html).toContain('href="/admin/nju-major-2026">赛事控制台');
    expect(html).not.toContain('href="/admin/nju-major-2026/matches"');
    expect(html).not.toContain('href="/admin/nju-major-2026/registrations"');
    expect(html).toContain('href="/admin/nju-major-2026/settings"');
  });

  it("hides settings and new-season actions from a season admin", async () => {
    checkAdminSessionMock.mockResolvedValue({
      role: "user",
      seasonIds: [seasonId],
    });
    mockSeasonRows([makeSeason()]);

    const html = await renderPage();

    expect(html).not.toContain('href="/admin/nju-major-2026/settings"');
    expect(html).not.toContain('href="/admin/seasons/new"');
    expect(html).toContain('href="/admin/nju-major-2026">赛事控制台');
  });

  it("shows the empty state when a season admin has no assigned seasons", async () => {
    checkAdminSessionMock.mockResolvedValue({
      role: "user",
      seasonIds: [],
    });
    mockSeasonRows([]);

    const html = await renderPage();

    expect(html).toContain("暂无赛季数据");
  });
});
