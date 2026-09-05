/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadWorkbenchMock, workbenchMock, notFoundMock } = vi.hoisted(() => ({
  loadWorkbenchMock: vi.fn(),
  workbenchMock: vi.fn(() => <div data-testid="workbench">workbench</div>),
  notFoundMock: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("@/lib/admin/matches/workbench", () => ({ loadAdminMatchWorkbench: loadWorkbenchMock }));
vi.mock("@/components/matches/AdminMatchWorkbench", () => ({ AdminMatchWorkbench: workbenchMock }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

import AdminMatchWorkbenchPage from "@/app/admin/[seasonSlug]/matches/[matchId]/page";

describe("AdminMatchWorkbenchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("fails closed when the match is missing or outside the requested season", async () => {
    loadWorkbenchMock.mockResolvedValue(null);

    await expect(AdminMatchWorkbenchPage({ params: Promise.resolve({ seasonSlug: "major", matchId: "other-season-match" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(workbenchMock).not.toHaveBeenCalled();
  });

  it("passes the scoped workbench read model to the detail surface", async () => {
    const data = {
      season: { id: "season-1", slug: "major", name: "Major" },
      stageName: "Swiss",
      match: { id: "match-1" },
      teamAName: "Alpha",
      teamBName: "Beta",
    };
    loadWorkbenchMock.mockResolvedValue(data);

    const html = renderToStaticMarkup(await AdminMatchWorkbenchPage({ params: Promise.resolve({ seasonSlug: "major", matchId: "match-1" }) }));

    expect(loadWorkbenchMock).toHaveBeenCalledWith({ seasonSlug: "major", matchId: "match-1" });
    expect(workbenchMock).toHaveBeenCalledWith(expect.objectContaining(data), undefined);
    expect(html).toContain("workbench");
  });
});
