import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildInsights, type InsightEntity } from "@/lib/stats/insights";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { Insights } from "./Insights";
vi.mock("next/link", () => ({ default: ({ href, scroll, ...props }: React.ComponentProps<"a"> & { scroll?: boolean }) => { void scroll; return <a href={href} {...props} />; } }));
describe("Insights presentation", () => {
  it("uses compact CS vocabulary and keeps methodology out of the normal surface", () => {
    const entities: InsightEntity[] = [0, 1, 2, 3].map((i) => ({ key: `player:${i}`, name: `Player ${i}`, href: `/players/${i}`, type: "player", metrics: {
      winAfterOpeningLoss: { kind: "probability", x: i ? 10 : 90, n: 100, value: i ? 0.1 : 0.9, coverage: "same" },
      openingDeathTradedRate: { kind: "probability", x: i ? 10 : 95, n: 100, value: i ? 0.1 : 0.95, coverage: "same" },
    } }));
    render(<Insights insights={buildInsights(entities, "Selected event")} query={parseStatsQuery({}, [])} seasonSlug="event" />);
    expect(screen.getByText(/FD Recovery/)).toBeInTheDocument();
    expect(screen.getByText("FD 100 · Traded 95 · Team Wins 90")).toBeInTheDocument();
    expect(screen.queryByText(/样本线|逐回合|区间|下界|不代表|不意味着|未校正|不能/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Why?"));
    expect(screen.getByText(/Win after FD：P87.5/)).toBeInTheDocument();
    expect(screen.getByText(/Traded FD%：P87.5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Insights 说明" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("从当前范围的数据中筛选出的突出表现与差异");
  });
});
