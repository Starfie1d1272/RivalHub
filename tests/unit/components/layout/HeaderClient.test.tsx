/** @vitest-environment jsdom */
import React from "react";
import Link from "next/link";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HeaderClient } from "@/components/layout/HeaderClient";
import { HeaderViewerClient } from "@/components/layout/HeaderViewerClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/actions/auth", () => ({ logoutUser: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

  it("shares a URL-keyed avatar failure across mobile viewer remounts and retries a new URL", async () => {
    const user = userEvent.setup();
    const session = { userId: "user-1", isAdmin: false, isSuperAdmin: false };
    const viewer = (avatarUrl: string) => (
      <HeaderViewerClient
        variant="mobile"
        session={session}
        avatarUrl={avatarUrl}
        displayName={null}
        perfectName="完美昵称"
        steamName="Steam Nick"
      />
    );
    const view = render(
      <HeaderClient desktopNavigation={null} mobileNavigation={null} desktopViewer={null} mobileViewer={viewer("https://cdn.example/avatar-old.jpg")} />,
    );

    await user.click(screen.getByRole("button", { name: "展开菜单" }));
    expect(screen.getByText("完美昵称")).toBeInTheDocument();
    fireEvent.error(screen.getByAltText("完美昵称"));
    expect(screen.queryByAltText("完美昵称")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起菜单" }));
    await user.click(screen.getByRole("button", { name: "展开菜单" }));
    expect(screen.queryByAltText("完美昵称")).not.toBeInTheDocument();

    view.rerender(
      <HeaderClient desktopNavigation={null} mobileNavigation={null} desktopViewer={null} mobileViewer={viewer("https://cdn.example/avatar-new.jpg")} />,
    );
    expect(screen.getByAltText("完美昵称")).toHaveAttribute("src", expect.stringContaining("avatar-new.jpg"));
  });
});
