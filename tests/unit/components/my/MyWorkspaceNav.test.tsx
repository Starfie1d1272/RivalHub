/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyWorkspaceNav } from "@/components/my/MyWorkspaceNav";

const { pathname } = vi.hoisted(() => ({ pathname: vi.fn(() => "/my/teams") }));
vi.mock("next/navigation", () => ({ usePathname: pathname }));

describe("MyWorkspaceNav", () => {
  it("uses a real nav and marks the current child route", () => {
    render(<MyWorkspaceNav />);
    expect(screen.getByRole("navigation", { name: "个人工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我的队伍" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "概览" })).not.toHaveAttribute("aria-current", "page");
  });

  it("keeps the overview exact instead of matching every /my path", () => {
    pathname.mockReturnValue("/my/competitions");
    render(<MyWorkspaceNav />);
    expect(screen.getByRole("link", { name: "我的赛事" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "概览" })).not.toHaveAttribute("aria-current", "page");
  });
});
