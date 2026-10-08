import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PerfectRoomGuide } from "@/components/matches/PerfectRoomGuide";
import { buildPerfectRoomGuide } from "@/lib/admin/matches/operator-workflow";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("PerfectRoomGuide", () => {
  it("copies round and description separately and never copies the instructions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const guide = buildPerfectRoomGuide({ seasonName: "Major", roundLabel: "Stage2", description: "2-2", teamAName: "Alpha", teamBName: "Beta", map: { order: 3, name: "de_nuke", startSide: null } });
    render(<PerfectRoomGuide guide={guide} />);
    fireEvent.click(screen.getByRole("button", { name: "复制轮次" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Stage2"));
    fireEvent.click(screen.getByRole("button", { name: "复制比赛短描述" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("2-2"));
    expect(screen.getByText("起始边尚未确定，请先核对 BP 选边")).toBeInTheDocument();
  });
});
