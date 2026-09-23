import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatsQuery } from "@/lib/stats/view-state";
import { StatsShell } from "./StatsShell";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, scroll, ...props }: { href: string; scroll?: boolean; [key: string]: unknown }) =>
      React.createElement("a", { href, "data-scroll": String(scroll), ...props }),
  };
});

const query: StatsQuery = {
  tab: "players",
  stage: "swiss",
  mapFilter: "de_ancient",
  teamFilter: "",
  player: "4ab08f95-e8e1-4d9e-8641-947dbcc37779",
  team: "",
  map: "",
};

describe("StatsShell navigation", () => {
  it("preserves scroll on tab and breadcrumb links", () => {
    render(
      <StatsShell
        query={query}
        seasonSlug="major"
        stages={[{ key: "swiss", name: "瑞士轮" }, { key: "playoff", name: "淘汰赛" }]}
        coverage={{ detailedMaps: 4, completedMaps: 7 }}
        selectedTitle="Player"
        directoryHref="/major/stats?tab=players"
      >
        <div>detail</div>
      </StatsShell>,
    );
    expect(screen.getAllByRole("link").every((link) => link.getAttribute("data-scroll") === "false")).toBe(true);
  });

  it("pushes stage selection with scroll disabled and preserves normal history semantics", () => {
    render(
      <StatsShell query={query} seasonSlug="major" stages={[{ key: "swiss", name: "瑞士轮" }, { key: "playoff", name: "淘汰赛" }]} coverage={{ detailedMaps: 0, completedMaps: 0 }}>
        <div />
      </StatsShell>,
    );
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "playoff" } });
    expect(router.push).toHaveBeenCalledWith("/major/stats?tab=players&stage=playoff", { scroll: false });
  });
});
