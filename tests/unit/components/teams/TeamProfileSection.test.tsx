/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamProfileSection } from "@/components/teams/TeamProfileSection";

vi.mock("@/components/teams/TeamLogoUpload", () => ({
  TeamLogoUpload: ({ teamId, currentLogoUrl, teamName, canEdit }: { teamId: string; currentLogoUrl: string | null; teamName: string; canEdit: boolean }) => (
    <div data-testid="team-logo-upload" data-team-id={teamId} data-logo-url={currentLogoUrl ?? ""} data-can-edit={String(canEdit)}>{teamName}</div>
  ),
}));

const baseProps = {
  team: { id: "team-1", name: "Rival Team", logoUrl: "https://example.com/team.png" },
  pending: false,
  name: "Rival Team",
  description: "公开简介",
  onNameChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onSave: vi.fn(),
};

describe("TeamProfileSection", () => {
  it("lets the captain edit the existing Team logo beside the profile fields", () => {
    render(<TeamProfileSection {...baseProps} />);

    const profile = document.getElementById("team-profile");
    expect(profile).toBeInTheDocument();
    expect(profile).toContainElement(screen.getByTestId("team-logo-upload"));
    expect(screen.getByTestId("team-logo-upload")).toHaveAttribute("data-team-id", "team-1");
    expect(screen.getByTestId("team-logo-upload")).toHaveAttribute("data-logo-url", "https://example.com/team.png");
    expect(screen.getByTestId("team-logo-upload")).toHaveAttribute("data-can-edit", "true");
    expect(screen.getByRole("button", { name: "保存资料" })).toBeInTheDocument();
    expect(screen.getByLabelText("队伍名称")).not.toBeDisabled();
    expect(screen.getByLabelText("简介")).not.toBeDisabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
