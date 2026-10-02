import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimMock } = vi.hoisted(() => ({ claimMock: vi.fn() }));
vi.mock("@/actions/postmatch", () => ({ claimMatchCommentary: claimMock }));
import { ClaimMatchButton } from "@/components/matches/ClaimMatchButton";

describe("ClaimMatchButton", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sends only the match id and disables duplicate clicks until the server responds", async () => {
    const user = userEvent.setup();
    let resolveClaim!: (value: { success: true }) => void;
    claimMock.mockReturnValue(new Promise((resolve) => { resolveClaim = resolve; }));
    render(<ClaimMatchButton matchId="match-1" />);
    await user.click(screen.getByRole("button", { name: "由我负责本场" }));
    expect(claimMock).toHaveBeenCalledExactlyOnceWith({ matchId: "match-1" });
    expect(screen.getByRole("button", { name: "正在认领…" })).toBeDisabled();
    await act(async () => resolveClaim({ success: true }));
    expect(screen.getByRole("button", { name: "已由你负责" })).toBeDisabled();
  });

  it("shows a server capacity conflict and permits retry without claiming success", async () => {
    const user = userEvent.setup();
    claimMock.mockResolvedValueOnce({ success: false, error: { message: "每场最多登记 2 名实际解说。" } }).mockResolvedValueOnce({ success: true });
    render(<ClaimMatchButton matchId="match-2" />);
    await user.click(screen.getByRole("button", { name: "由我负责本场" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每场最多登记 2 名实际解说。");
    await user.click(screen.getByRole("button", { name: "由我负责本场" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已由你负责" })).toBeDisabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
