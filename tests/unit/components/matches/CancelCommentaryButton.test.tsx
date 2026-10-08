import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelMock } = vi.hoisted(() => ({ cancelMock: vi.fn() }));
vi.mock("@/actions/postmatch", () => ({ cancelMatchCommentary: cancelMock }));
import { CancelCommentaryButton } from "@/components/matches/CancelCommentaryButton";

describe("cancel commentary confirmation", () => {
  beforeEach(() => vi.resetAllMocks());

  // UI evidence covers consent and in-flight clicks; database tests own the state matrix.
  it("requires confirmation, allows backing out, and prevents duplicate requests", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { success: true }) => void;
    cancelMock.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<CancelCommentaryButton matchId="match-1" />);
    await user.click(screen.getByRole("button", { name: "取消认领" }));
    expect(cancelMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^取消$/ }));
    expect(cancelMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消认领" }));
    await user.click(screen.getByRole("button", { name: "确认取消认领" }));
    expect(cancelMock).toHaveBeenCalledExactlyOnceWith({ matchId: "match-1" });
    expect(screen.getByRole("button", { name: "正在取消…" })).toBeDisabled();
    await act(async () => resolve({ success: true }));
    expect(screen.getByRole("button", { name: "已取消认领" })).toBeDisabled();
  });

  it("shows a stale-state rejection and allows retry without reporting success", async () => {
    const user = userEvent.setup();
    cancelMock.mockResolvedValue({ success: false, error: { message: "本场已进入制作准备，请联系管理员调整解说安排。" } });
    render(<CancelCommentaryButton matchId="match-1" />);
    await user.click(screen.getByRole("button", { name: "取消认领" }));
    await user.click(screen.getByRole("button", { name: "确认取消认领" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请联系管理员");
    expect(screen.getByRole("button", { name: "取消认领" })).toBeEnabled();
  });
});
