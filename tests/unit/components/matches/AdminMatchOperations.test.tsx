import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminMatchOperations } from "@/components/matches/AdminMatchOperations";
import type { AdminMatchOperationsRow } from "@/lib/admin/matches/operations";
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function row(id: string, state: "unproposed" | "confirmed", stage = "play-in"): AdminMatchOperationsRow {
  return { id, stage, round: 1, entryAId: "a", entryBId: "b", scheduledAt: null, completionDeadline: null,
    scheduling: { state, pending: null, autoAcceptAt: null }, responseDueAt: null,
    teams: [{ id: "a", name: "Alpha", representative: { userId: "current-rep", name: "当前赛事队长", qq: "123456" } }, { id: "b", name: "Beta", representative: null }],
    awaitingEntryIds: state === "unproposed" ? ["a", "b"] : [], commentators: [{ userId: "caster", name: "解说员", playerUserId: null }], conflicts: [] };
}
describe("admin match operations", () => {
  it("distinguishes confirmed time from lifecycle, scopes counters and copies a contact-free reminder", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<AdminMatchOperations rows={[row("pending", "unproposed"), row("confirmed", "confirmed"), row("other", "unproposed", "swiss")]} seasonSlug="major" stage="play-in" stageNames={{}} />);
    expect(screen.getByText(/全赛季.*3 场.*当前阶段.*2 场/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "进入比赛工作台" })).toHaveLength(1);
    expect(screen.getByText(/下一步：Alpha、Beta 提议时间/)).toBeInTheDocument();
    expect(screen.getByText(/负责人：当前赛事队长/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制催办文字" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toContain("/major/matches/pending?scheduling=1");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("123456");
    fireEvent.click(screen.getByRole("button", { name: "已确认 1" }));
    expect(screen.getByRole("link", { name: "进入比赛工作台" })).toHaveAttribute("href", "/admin/major/matches/confirmed");
    expect(screen.queryByRole("button", { name: "复制催办文字" })).not.toBeInTheDocument();
  });
});
