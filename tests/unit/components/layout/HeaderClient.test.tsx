/** @vitest-environment jsdom */
import React from "react";
import Link from "next/link";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { HeaderClient } from "@/components/layout/HeaderClient";

function renderHeader() {
  return render(
    <HeaderClient
      desktopNavigation={<Link href="/teams">桌面导航</Link>}
      mobileNavigation={
        <Link href="/teams" onClick={(event) => event.preventDefault()}>
          移动导航
        </Link>
      }
      desktopViewer={<span>桌面用户</span>}
      mobileViewer={<span>移动用户</span>}
    />,
  );
}

describe("HeaderClient mobile navigation", () => {
  it("keeps the desktop navigation rendered and exposes an accessible mobile toggle", async () => {
    const user = userEvent.setup();
    renderHeader();

    const toggle = screen.getByRole("button", { name: "展开菜单" });
    expect(screen.getByText("桌面导航")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "rivalhub-mobile-navigation");

    toggle.focus();
    await user.keyboard("{Enter}");

    const mobileMenu = document.getElementById("rivalhub-mobile-navigation");
    expect(mobileMenu).not.toBeNull();
    expect(mobileMenu).toHaveClass("col-span-full", "min-w-0");
    expect(screen.getByRole("button", { name: "收起菜单" })).toHaveAttribute("aria-expanded", "true");
  });

  it("closes after a mobile navigation link is activated", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "展开菜单" }));
    await user.click(screen.getByRole("link", { name: "移动导航" }));

    expect(document.getElementById("rivalhub-mobile-navigation")).toBeNull();
    expect(screen.getByRole("button", { name: "展开菜单" })).toHaveAttribute("aria-expanded", "false");
  });
});
