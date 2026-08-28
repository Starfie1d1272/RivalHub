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

const { uploadTeamApplicationLogoMock, uploadTeamLogoMock } = vi.hoisted(() => ({
  uploadTeamApplicationLogoMock: vi.fn(),
  uploadTeamLogoMock: vi.fn(),
}));

vi.mock("@/actions/team-applications", () => ({ uploadTeamApplicationLogo: uploadTeamApplicationLogoMock }));
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
    uploadTeamApplicationLogoMock.mockResolvedValue({
      success: true,
      data: { logoUrl: "https://storage.test/applications/app-1/logo.png" },
    });
  });

  it("calls the optional callback with the persisted logo URL", async () => {
    const onUploaded = vi.fn();
    render(
      <TeamLogoUpload
        applicationId="app-1"
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
      expect(uploadTeamApplicationLogoMock).toHaveBeenCalledWith("app-1", expect.any(FormData));
      expect(onUploaded).toHaveBeenCalledWith("https://storage.test/applications/app-1/logo.png");
    });
  });

  it("opens the file picker from the editable logo control", () => {
    render(
      <TeamLogoUpload
        applicationId="app-1"
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
});
