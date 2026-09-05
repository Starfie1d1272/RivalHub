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
      registrationMode="team"
      hasCaptainVoting={true}
      hasDraft={true}
      hasCommunityAwards={true}
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

    expect(screen.getByRole("link", { name: "纪律与处罚" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/discipline",
    );
  });

  it("keeps the discipline entry available regardless of draft/captain/match capabilities", () => {
    renderNav({ hasCaptainVoting: false, hasDraft: false, hasMatches: false });

    expect(screen.getByRole("link", { name: "纪律与处罚" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "队长确认" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "选秀控制" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "赛程管理" })).not.toBeInTheDocument();
  });

  it("organizes the workspace by lifecycle and keeps the governance routes available", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "总览" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026",
    );
    expect(screen.getByRole("link", { name: "报名" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/registrations",
    );
    expect(screen.getByRole("link", { name: "赛前" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/prestart",
    );
    expect(screen.getByRole("link", { name: "比赛" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/matches",
    );
    expect(screen.getByRole("link", { name: "赛后" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/post-event",
    );
    expect(screen.getByRole("link", { name: "操作日志" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/logs",
    );
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute(
      "href",
      "/admin/nju-major-2026/settings",
    );
  });

  it("marks the discipline tab active on the discipline page", () => {
    pathnameMock.mockReturnValue("/admin/nju-major-2026/discipline");
    renderNav();

    const link = screen.getByRole("link", { name: "纪律与处罚" });
    expect(link.style.borderBottom).toContain("var(--color-accent)");
  });

  it("hides the community-awards tab when the season capability is disabled", () => {
    renderNav({ hasCommunityAwards: false });

    expect(screen.queryByRole("link", { name: "社区奖" })).not.toBeInTheDocument();
  });

  it("keeps the prestart tab active for retained captain and draft URLs", () => {
    pathnameMock.mockReturnValue("/admin/nju-major-2026/draft");
    renderNav();

    expect(screen.getByRole("link", { name: "赛前" }).style.borderBottom).toContain("var(--color-accent)");
    expect(screen.queryByRole("link", { name: "选秀控制" })).not.toBeInTheDocument();
  });

  it("hides settings from a season admin while keeping the workspace routes", () => {
    renderNav({ showSettings: false });

    expect(screen.queryByRole("link", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "总览" })).toBeInTheDocument();
  });
});
