import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PerfectRoomGuide } from "@/components/matches/PerfectRoomGuide";
import { buildPerfectRoomGuide } from "@/lib/admin/matches/operator-workflow";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("PerfectRoomGuide", () => {
  it("copies round and description separately and never copies the instructions", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const guide = buildPerfectRoomGuide({ seasonName: "Major", roundLabel: "Stage2", description: "2-2", teamAName: "Alpha", teamBName: "Beta", map: { order: 3, name: "de_nuke", startSide: null } });
    render(<PerfectRoomGuide guide={guide} />);
    await user.click(screen.getByRole("button", { name: "复制轮次" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Stage2"));
    await user.click(screen.getByRole("button", { name: "复制比赛短描述" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("2-2"));
    expect(screen.getByRole("link", { name: /打开 Perfect 后台/ })).toHaveAttribute("href", "https://match.wmpvp.com/");
    // Protect the approved form sequence, which was split into two groups before.
    expect(Array.from(document.querySelectorAll("dt"), item => item.textContent)).toEqual([
      "比赛归属", "轮次", "比赛短描述", "游戏模式", "队伍 1", "队伍 1 教练 64 位 ID", "队伍 2", "队伍 2 教练 64 位 ID", "选图模式", "服务器", "观察者", "GOTV 线路 1 延迟", "GOTV 线路 2 延迟", "GOTV Password", "选边方式", "测试赛",
    ]);
    expect(screen.queryByRole("button", { name: "复制选图模式" })).not.toBeInTheDocument();
    expect(screen.getByText("起始边尚未确定，请先核对 BP 选边")).toBeInTheDocument();
  });
});
