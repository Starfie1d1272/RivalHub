/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsLayout from "@/app/settings/layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));

describe("SettingsLayout", () => {
  it("places the desktop navigation column before the content so it renders on the left", () => {
    render(
      <SettingsLayout>
        <div data-testid="settings-content">内容</div>
      </SettingsLayout>,
    );
    const content = screen.getByTestId("settings-content");
    const grid = content.closest("div.grid");
    expect(grid).not.toBeNull();
    expect(grid!.classList.contains("lg:grid-cols-[17rem_minmax(0,1fr)]")).toBe(true);

    const aside = grid!.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside!.className).toContain("sticky");
    expect(aside!.className).toContain("hidden");
    expect(aside!.className).toContain("lg:block");
    // DOM order决定 grid 列位：aside 必须位于内容之前，导航才落在左列。
    expect(aside!.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aside!.querySelector("nav[aria-label=\"参赛资料导航\"]")).not.toBeNull();
  });

  it("keeps the mobile top navigation above the grid and hidden on desktop", () => {
    const { container } = render(
      <SettingsLayout>
        <div>内容</div>
      </SettingsLayout>,
    );
    const topNav = container.querySelector("div.lg\\:hidden > nav[aria-label=\"参赛资料导航\"]");
    expect(topNav).not.toBeNull();
    const grid = container.querySelector("div.grid");
    expect(grid!.contains(topNav!)).toBe(false);
  });
});
