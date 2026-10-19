import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MatchLineupComparison, type MatchLineupComparisonProps } from "@/components/matches/MatchLineupComparison";
import type { LineupCareer, LineupPlayer } from "@/lib/matches/lineup-comparison";

afterEach(cleanup);
const player = (userId: string): LineupPlayer => ({ userId, displayName: userId, personaName: null, perfectName: null, avatarUrl: null, isStarter: true });
const career = (userId: string, rating: number): LineupCareer => ({ userId, maps: 10, rounds: 240, qualified: true, rating, adr: 80, kpr: 0.75, kast: 0.725, firstKill: 0.12, trade: 0 });
const props: MatchLineupComparisonProps = {
  a: { entryId: "team-a", name: "A", players: [player("a1"), player("a2")], expected: false },
  b: { entryId: "team-b", name: "B", players: [player("b1")], expected: true },
  careers: [career("a1", 1.1), career("a2", 1.3), career("b1", 1.2)], historical: false,
};

it("selects qualified stars, switches by keyboard and keeps profile navigation separate", async () => {
  const user = userEvent.setup();
  render(<MatchLineupComparison {...props} />);
  expect(screen.getByRole("button", { name: "选择 a2" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("link", { name: "a1 的个人主页" })).toHaveAttribute("href", "/players/a1");
  const select = screen.getByRole("button", { name: "选择 a1" });
  select.focus();
  await user.keyboard("{Enter}");
  expect(select).toHaveAttribute("aria-pressed", "true");
  const comparison = within(screen.getByLabelText("选手关键数据对比"));
  expect(comparison.getByText("1.10")).toBeInTheDocument();
  expect(comparison.getAllByText("0.0")).toHaveLength(2);
  expect(comparison.getAllByText("72.5%")).toHaveLength(2);
  expect(screen.getByText("预计阵容")).toBeInTheDocument();
});

it("collapses missing comparisons, preserves both rosters and restores on selection", async () => {
  const user = userEvent.setup();
  render(<MatchLineupComparison {...props} careers={props.careers.filter((row) => row.userId !== "a1")} />);
  await user.click(screen.getByRole("button", { name: "选择 a1" }));
  expect(screen.queryByLabelText("选手关键数据对比")).not.toBeInTheDocument();
  expect(screen.getByText(/暂无双方可对照数据/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "选择 a2" }));
  expect(screen.getByLabelText("选手关键数据对比")).toBeInTheDocument();
  cleanup();
  render(<MatchLineupComparison {...props} careers={[]} />);
  expect(screen.queryByText("HIGHLIGHTED STATS")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /选择 / })).toHaveLength(3);
});

it("reselects a replacement starter after refresh, preserving the other side", () => {
  const { rerender } = render(<MatchLineupComparison {...props} />);
  rerender(<MatchLineupComparison {...props} a={{ ...props.a, players: [player("a1")] }} />);
  expect(screen.getByRole("button", { name: "选择 a1" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "选择 b1" })).toHaveAttribute("aria-pressed", "true");
});
