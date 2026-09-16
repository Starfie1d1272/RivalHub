/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserList } from "@/components/admin/AdminUserList";

const { revokeUserAdminRoleMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  revokeUserAdminRoleMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/actions/admin", () => ({ revokeUserAdminRole: revokeUserAdminRoleMock }));
vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

const users = [
  {
    id: "admin-1",
    email: "admin@example.test",
    displayName: "赛事管理员",
    perfectName: null,
    steamName: null,
    steam64: "76561198000000001",
    liveStreamUrl: "https://live.example/admin",
    role: "season_admin" as const,
    seasonIds: ["season-1"],
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "admin-2",
    email: "super@example.test",
    displayName: "超级管理员",
    perfectName: null,
    steamName: null,
    steam64: null,
    liveStreamUrl: null,
    role: "super_admin" as const,
    seasonIds: [],
    createdAt: "2026-09-02T00:00:00.000Z",
  },
];

describe("AdminUserList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows protected admin identity, scope, and explicit missing profile states", () => {
    render(<AdminUserList users={users} seasonMap={{ "season-1": "Major 2026" }} currentUserId="admin-1" />);

    expect(screen.getAllByText("超级管理员")).toHaveLength(2);
    expect(screen.getByText("全局")).toBeInTheDocument();
    expect(screen.getByText("Major 2026")).toBeInTheDocument();
    expect(screen.getByText("76561198000000001")).toBeInTheDocument();
    expect(screen.getByText("https://live.example/admin")).toBeInTheDocument();
    expect(screen.getByText("未填写 Steam64")).toBeInTheDocument();
    expect(screen.getByText("未填写直播间")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "复制 Steam64" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "复制直播间" })).toHaveLength(1);
  });

  it("copies only non-empty row values", async () => {
    render(<AdminUserList users={users} seasonMap={{ "season-1": "Major 2026" }} currentUserId="admin-1" />);

    fireEvent.click(screen.getByRole("button", { name: "复制 Steam64" }));
    fireEvent.click(screen.getByRole("button", { name: "复制直播间" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(1, "76561198000000001");
      expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(2, "https://live.example/admin");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Steam64已复制");
    expect(toastSuccessMock).toHaveBeenCalledWith("直播间已复制");
  });
});
