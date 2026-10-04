import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildInsights, type InsightEntity } from "@/lib/stats/insights";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { Insights } from "./Insights";
vi.mock("next/link", () => ({ default: ({ href, scroll, ...props }: React.ComponentProps<"a"> & { scroll?: boolean }) => { void scroll; return <a href={href} {...props} />; } }));
describe("Insights presentation", () => {
  it("shows both opening numerators and explains that a shared denominator does not establish overlap", () => {
    const entities: InsightEntity[] = [0, 1, 2, 3].map((i) => ({ key: `player:${i}`, name: `Player ${i}`, href: `/players/${i}`, type: "player", metrics: {
      winAfterOpeningLoss: { kind: "probability", x: i ? 10 : 90, n: 100, value: i ? 0.1 : 0.9, coverage: "same" },
      openingDeathTradedRate: { kind: "probability", x: i ? 10 : 95, n: 100, value: i ? 0.1 : 0.95, coverage: "same" },
    } }));
    render(<Insights insights={buildInsights(entities, "Selected event")} query={parseStatsQuery({}, [])} seasonSlug="event" />);
    expect(screen.getByText(/FD recovery \+ trade/)).toBeInTheDocument();
    expect(screen.getByText(/90\/100/)).toBeInTheDocument();
    expect(screen.getByText(/95\/100/)).toBeInTheDocument();
    expect(screen.getByText(/回合交集可通过逐回合记录核对/)).toBeInTheDocument();
    expect(screen.queryByText(/区间|下界|靠前|不代表|不意味着|未校正|不能/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Insights 说明" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("按当前范围的样本量、分位和同类差距筛选的统计摘要");
  });
});
