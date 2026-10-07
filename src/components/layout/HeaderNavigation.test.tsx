import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeaderNavigation, HeaderNavigationFallback } from "./HeaderNavigation";
const state = vi.hoisted(() => ({ pathname: "/stats" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }));
describe("fixed platform navigation", () => {
  it.each([false, true])("shows the active event and highlights only its destination (mobile=%s)", (mobile) => {
    const activeSeason = { slug: "current", name: "2026 NJU Major 炸鸡杯" };
    const seasons = [activeSeason, { slug: "historical" }];
    state.pathname = "/current/matches";
    const { rerender } = render(<HeaderNavigation seasons={seasons} activeSeason={activeSeason} mobile={mobile} />);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/seasons", "/current", "/teams", "/stats"]);
    expect(screen.getByRole("link", { name: activeSeason.name })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "赛事" })).not.toHaveAttribute("aria-current");
    state.pathname = "/historical/matches";
    rerender(<HeaderNavigation seasons={seasons} activeSeason={activeSeason} mobile={mobile} />);
    expect(screen.getByRole("link", { name: "赛事" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: activeSeason.name })).not.toHaveAttribute("aria-current");
    state.pathname = "/current-other";
    rerender(<HeaderNavigation seasons={seasons} activeSeason={activeSeason} mobile={mobile} />);
    expect(screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toHaveLength(0);
    state.pathname = "/stats";
  });
  it.each([0, 2, 20, 100])("has three destinations with %i events, including mobile/fallback", (count) => {
    const seasons = Array.from({ length: count }, (_, i) => ({ slug: `event-${i}`, name: "中文长名称".repeat(10), status: "archived" as const, registrationOpensAt: null, registrationOpenedAt: null, registrationClosesAt: null }));
    const { rerender } = render(<HeaderNavigation seasons={seasons} />);
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/seasons", "/teams", "/stats"]);
    expect(screen.getByRole("link", { name: "数据中心" })).toHaveAttribute("aria-current", "page");
    rerender(<HeaderNavigation seasons={seasons} mobile />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    rerender(<HeaderNavigationFallback mobile />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["赛事", "队伍", "数据中心"]);
  });
  it("matches path boundaries and highlights event pages as events", () => {
    state.pathname = "/event-one/matches";
    const { rerender } = render(<HeaderNavigation seasons={[{ slug: "event-one" }]} />);
    expect(screen.getByRole("link", { name: "赛事" })).toHaveAttribute("aria-current", "page");
    state.pathname = "/event-one-more";
    rerender(<HeaderNavigation seasons={[{ slug: "event-one" }]} />);
    expect(screen.getByRole("link", { name: "赛事" })).not.toHaveAttribute("aria-current");
    state.pathname = "/teams-more";
    rerender(<HeaderNavigation seasons={[]} />);
    expect(screen.getByRole("link", { name: "队伍" })).not.toHaveAttribute("aria-current");
    state.pathname = "/stats";
  });
});
