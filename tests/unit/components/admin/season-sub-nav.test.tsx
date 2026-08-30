/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: pathnameMock,
}));

import { SeasonSubNav } from "@/components/admin/SeasonSubNav";

function renderNav(props: Partial<Parameters<typeof SeasonSubNav>[0]> = {}) {
  return render(
    <SeasonSubNav
      seasonSlug="nju-major-2026"
      hasCaptainVoting={true}
      hasDraft={true}
      hasMatches={true}
      showSettings={true}
      {...props}
    />,
  );
}

describe("SeasonSubNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue("/admin/nju-major-2026");
  });

  it("links 纪律处罚 to the season discipline admin page", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "纪律处罚" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/discipline",
    );
  });

  it("keeps the discipline entry available regardless of draft/captain/match capabilities", () => {
    renderNav({ hasCaptainVoting: false, hasDraft: false, hasMatches: false });

    expect(screen.getByRole("link", { name: "纪律处罚" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "队长确认" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "选秀控制" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "赛程管理" })).not.toBeInTheDocument();
  });

  it("does not disturb the existing prestart/runtime/post-event console tabs", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "赛事控制台" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026",
    );
    expect(screen.getByRole("link", { name: "报名审核" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/registrations",
    );
    expect(screen.getByRole("link", { name: "赛事日志" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/logs",
    );
    expect(screen.getByRole("link", { name: "队长确认" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/captains",
    );
    expect(screen.getByRole("link", { name: "选秀控制" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/draft",
    );
    expect(screen.getByRole("link", { name: "赛程管理" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/matches",
    );
    expect(screen.getByRole("link", { name: "赛季设置" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/settings",
    );
  });

  it("marks the discipline tab active on the discipline page", () => {
    pathnameMock.mockReturnValue("/admin/nju-major-2026/discipline");
    renderNav();

    const link = screen.getByRole("link", { name: "纪律处罚" });
    expect(link.style.borderBottom).toContain("var(--color-accent)");
  });
});
