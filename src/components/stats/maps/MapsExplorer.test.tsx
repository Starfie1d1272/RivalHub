import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { MapsExplorer } from "./MapsExplorer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, scroll, ...props }: { href: string; scroll?: boolean; [key: string]: unknown }) =>
      React.createElement("a", { href, "data-scroll": String(scroll), ...props }),
  };
});

function vetoData() {
  return {
    results: { maps: [] },
    analytics: { maps: [] },
    coverage: { completedMaps: 0, detailedMaps: 0, maps: [] },
    options: { maps: ["de_ancient"], teams: [] },
    selection: [{
      mapName: "de_ancient",
      picks: 3,
      bans: 6,
      deciders: 0,
      teams: [
        { entryId: "alpha", name: "Alpha", picks: 2, bans: 1 },
        { entryId: "zulu", name: "Zulu", picks: 1, bans: 5 },
      ],
    }],
    veto: {
      teams: [
        { entryId: "zulu", name: "Zulu", vetoes: 5 },
        { entryId: "alpha", name: "Alpha", vetoes: 2 },
      ],
      sample: { finishedMatches: 5, applicableMatches: 5, recordedMatches: 5, missingMatches: 0, notApplicableMatches: 0 },
    },
  } as unknown as TournamentStats;
}

describe("MapsExplorer veto matrix", () => {
  it("uses neutral Pick/Ban values and sorts every leaf column with shared stats semantics", () => {
    render(<MapsExplorer data={vetoData()} query={parseStatsQuery({ tab: "maps", mapsView: "veto" }, [])} seasonSlug="major" />);

    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(2);
    expect(bodyRows.map((row) => row.textContent)).toEqual(["Alpha22 1", "Zulu51 5"]);

    const banButton = screen.getByRole("button", { name: "Sort by Ban" });
    fireEvent.click(banButton);
    expect(within(table).getAllByRole("row").slice(2).map((row) => row.textContent)).toEqual(["Zulu51 5", "Alpha22 1"]);
    expect(screen.getByRole("button", { name: "Ban ↓" })).toBeInTheDocument();

    const banValue = within(screen.getByRole("row", { name: /Zulu/ })).getByText("5", { selector: "span" });
    expect(banValue).toHaveClass("text-[var(--color-fg)]");
    expect(banValue).not.toHaveClass("text-[var(--color-danger)]");
  });
});
