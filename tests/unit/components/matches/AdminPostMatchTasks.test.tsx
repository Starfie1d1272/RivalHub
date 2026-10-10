import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { AdminPostMatchTasks } from "@/components/matches/AdminPostMatchTasks";
import type { AdminPostMatchTaskRow } from "@/lib/admin/matches/postmatch-tasks";

const rows: AdminPostMatchTaskRow[] = [
  { id: "other", stage: "play-in", entryAId: "a", entryBId: "b", teamAName: "Other Alpha", teamBName: "Other Beta", isMine: false, tasks: [{ label: "Map 1 · Demo 待上传", anchor: "scoreboard-map" }] },
  { id: "mine", stage: "stage1", entryAId: "c", entryBId: "d", teamAName: "My Alpha", teamBName: "My Beta", isMine: true, tasks: [{ label: "登记解说回放", anchor: "match-workbench-finished-postmatch" }] },
];
// Protects prioritization, discoverability of unclaimed gaps, filter scope and actionable destinations.
describe("post-match overview tasks", () => {
  it("prioritizes my games and keeps other authorized gaps expandable", async () => {
    render(<AdminPostMatchTasks rows={rows} seasonSlug="event" stageNames={{}} />);
    const mine = within(screen.getByRole("region", { name: "我负责的赛后待办" }));
    expect(mine.getByRole("link", { name: "登记解说回放 →" })).toHaveAttribute("href", "/admin/event/matches/mine#match-workbench-finished-postmatch");
    await userEvent.setup().click(screen.getByText("其它比赛 · 1 场待补齐"));
    expect(screen.getByRole("link", { name: "Map 1 · Demo 待上传 →" })).toBeVisible();
  });
  it("shows unclaimed games directly when filters exclude personal games", () => {
    render(<AdminPostMatchTasks rows={rows} seasonSlug="event" stage="play-in" team="a" stageNames={{}} />);
    expect(screen.getByRole("link", { name: "Map 1 · Demo 待上传 →" })).toBeVisible();
    expect(screen.queryByText("My Alpha vs My Beta")).not.toBeInTheDocument();
  });
});
