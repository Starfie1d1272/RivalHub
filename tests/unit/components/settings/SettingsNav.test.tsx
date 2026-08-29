/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsNav } from "@/components/settings/SettingsNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/competitive" }));

describe("SettingsNav", () => {
  it("keeps every settings destination available and highlights the current page", () => {
    render(<SettingsNav />);
    expect(screen.getByRole("link", { name: /参赛资料/ })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: /教育身份/ })).toHaveAttribute("href", "/settings/education");
    expect(screen.getByRole("link", { name: /竞技档案/ })).toHaveClass("text-[var(--color-accent)]");
    expect(screen.getByRole("link", { name: /账号与安全/ })).toHaveAttribute("href", "/settings/password");
    expect(screen.queryByRole("link", { name: /隐私/ })).not.toBeInTheDocument();
  });
});
