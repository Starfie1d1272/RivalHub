import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { MatchRecordings } from "@/components/matches/MatchRecordings";
it("groups more than five explicit labels per commentator and retains an unattributed legacy link", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), commentatorUserId: i < 6 ? "a" : "b", title: `录像 ${i + 1}`, url: `https://video.example/${i}` }));
  render(<MatchRecordings recordings={rows} legacyUrl="https://video.example/legacy" commentators={[{ userId: "a", name: "解说甲" }, { userId: "b", name: "解说乙" }]} />);
  expect(screen.getByText("比赛回放 · 13 ▾")).toBeInTheDocument();
  const group = screen.getByText("解说甲").closest("section")!;
  expect(within(group).getAllByRole("link", { hidden: true })).toHaveLength(6);
  expect(screen.getByText("原有录像 ↗")).toHaveAttribute("href", "https://video.example/legacy");
  expect(screen.getByText("录像 8 ↗")).toHaveAttribute("rel", "noopener noreferrer");
});
