/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPlayerContact } from "@/components/admin/AdminPlayerContact";

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

describe("AdminPlayerContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("keeps privileged contact details collapsed until the operator opens them", async () => {
    render(<AdminPlayerContact email="player@example.test" qq="12345678" steam64="76561198000000001" steamProfileUrl="https://steamcommunity.com/id/player" />);

    expect(screen.queryByText("player@example.test")).not.toBeVisible();
    fireEvent.click(screen.getByText("联系"));
    expect(screen.getByText("player@example.test")).toBeVisible();
    expect(screen.getByRole("link", { name: "打开主页 ↗" })).toHaveAttribute("href", "https://steamcommunity.com/id/player");

    fireEvent.click(screen.getByRole("button", { name: "复制QQ" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("12345678"));
    expect(toastSuccessMock).toHaveBeenCalledWith("QQ 已复制");
  });

  it("states missing contact data without exposing empty controls", () => {
    render(<AdminPlayerContact />);
    fireEvent.click(screen.getByText("联系"));

    expect(screen.getByText("暂无可用联系方式")).toBeVisible();
    expect(screen.queryByRole("button", { name: /复制/ })).not.toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
