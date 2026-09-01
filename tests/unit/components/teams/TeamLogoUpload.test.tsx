/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamLogoUpload } from "@/components/teams/TeamLogoUpload";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [false, (work: () => void) => void work()] };
});

const { uploadTeamLogoMock } = vi.hoisted(() => ({
  uploadTeamLogoMock: vi.fn(),
}));

vi.mock("@/actions/teams", () => ({ uploadTeamLogo: uploadTeamLogoMock }));
vi.mock("next/image", () => ({
  default: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("TeamLogoUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:logo") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    uploadTeamLogoMock.mockResolvedValue({
      success: true,
      data: { logoUrl: "https://storage.test/teams/team-1/logo.png" },
    });
  });

  it("calls the optional callback with the persisted logo URL", async () => {
    const onUploaded = vi.fn();
    render(
      <TeamLogoUpload
        teamId="team-1"
        currentLogoUrl={null}
        teamName="Rival Team"
        canEdit
        onUploaded={onUploaded}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(["png"], "logo.png", { type: "image/png" })] } });

    await waitFor(() => {
      expect(uploadTeamLogoMock).toHaveBeenCalledWith("team-1", expect.any(FormData));
      expect(onUploaded).toHaveBeenCalledWith("https://storage.test/teams/team-1/logo.png");
    });
  });

  it("opens the file picker from the editable logo control", () => {
    render(
      <TeamLogoUpload
        teamId="team-1"
        currentLogoUrl={null}
        teamName="Rival Team"
        canEdit
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const click = vi.fn();
    Object.defineProperty(input, "click", { configurable: true, value: click });
    fireEvent.click(screen.getByRole("button", { name: "更换队伍图标" }));

    expect(click).toHaveBeenCalledOnce();
  });

  it("uses a focusable button for keyboard-accessible logo editing", () => {
    render(
      <TeamLogoUpload
        teamId="team-1"
        currentLogoUrl={null}
        teamName="Rival Team"
        canEdit
      />,
    );

    const control = screen.getByRole("button", { name: "更换队伍图标" });
    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveAttribute("type", "button");
    control.focus();
    expect(control).toHaveFocus();
    expect(control).toHaveClass("focus-visible:ring-2");
  });
});
