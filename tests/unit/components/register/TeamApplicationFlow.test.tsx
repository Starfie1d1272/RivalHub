/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamApplicationJoinLink, submitTeamApplication } from "@/actions/team-applications";
import { TeamApplicationFlow } from "@/components/register/TeamApplicationFlow";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/team-applications", () => ({
  confirmTeamApplicationMembership: vi.fn(),
  createTeamApplication: vi.fn(),
  createTeamApplicationJoinLink: vi.fn(),
  inviteTeamApplicationMember: vi.fn(),
  removeTeamApplicationMember: vi.fn(),
  submitTeamApplication: vi.fn(),
  updateTeamApplication: vi.fn(),
}));

vi.mock("@/components/teams/TeamLogoUpload", () => ({
  TeamLogoUpload: ({ onUploaded }: { onUploaded?: (logoUrl: string) => void }) => (
    <button type="button" onClick={() => onUploaded?.("https://storage.test/applications/app-1/logo.png")}>
      模拟上传队标
    </button>
  ),
}));

const submitTeamApplicationMock = vi.mocked(submitTeamApplication);
const createTeamApplicationJoinLinkMock = vi.mocked(createTeamApplicationJoinLink);

const members = Array.from({ length: 5 }, (_, index) => ({
  id: `member-${index + 1}`,
  userId: index === 0 ? "captain" : `player-${index + 1}`,
  email: `player-${index + 1}@example.com`,
  displayName: `Player ${index + 1}`,
  emailVerified: true,
  educationStatus: "approved" as const,
  institutionName: "南京大学",
  status: "confirmed" as const,
  readinessBlockers: [],
}));

const baseProps = {
  seasonId: "season-1",
  seasonName: "NJU Major",
  currentUserId: "captain",
  minTeamSize: 5,
  maxTeamSize: 9,
  requireTeamLogo: true,
  application: {
    id: "app-1",
    name: "Rival Team",
    logoUrl: null,
    perfectTeamId: "pw-team-1",
    primaryStarterUserIds: members.map((member) => member.userId),
    captainUserId: "captain",
    status: "draft" as const,
    reviewReason: null,
  },
  members,
  qualification: {
    njuPrimaryCount: 3,
    externalStrength: { state: "pass" as const, blockers: [] },
  },
};

describe("TeamApplicationFlow logo readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitTeamApplicationMock.mockResolvedValue({ success: true, data: undefined });
  });

  it("blocks a required-logo application when no logo is persisted", () => {
    render(<TeamApplicationFlow {...baseProps} />);

    expect(screen.getByText("队标未上传")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成报名检查后可提交" })).toBeDisabled();
  });

  it("starts complete when the application already has a logo", () => {
    render(
      <TeamApplicationFlow
        {...baseProps}
        application={{ ...baseProps.application, logoUrl: "https://storage.test/applications/app-1/logo.png" }}
      />,
    );

    expect(screen.getByText("队标已上传")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交审核" })).not.toBeDisabled();
  });

  it("submits when all required checks are complete", async () => {
    const user = userEvent.setup();
    render(
      <TeamApplicationFlow
        {...baseProps}
        application={{ ...baseProps.application, logoUrl: "https://storage.test/applications/app-1/logo.png" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "提交审核" }));

    await waitFor(() => expect(submitTeamApplicationMock).toHaveBeenCalledWith({ applicationId: "app-1" }));
  });

  it("updates readiness immediately after the upload callback", async () => {
    const user = userEvent.setup();
    render(<TeamApplicationFlow {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "模拟上传队标" }));

    await waitFor(() => {
      expect(screen.getByText("队标已上传")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "提交审核" })).not.toBeDisabled();
    });
  });

  it("does not add a blocking logo check for a non-required season", () => {
    render(<TeamApplicationFlow {...baseProps} requireTeamLogo={false} />);

    expect(screen.queryByText("队标未上传")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交审核" })).not.toBeDisabled();
  });

  it("generates and copies a revocable join link instead of claiming an email was sent", async () => {
    const user = userEvent.setup();
    createTeamApplicationJoinLinkMock.mockResolvedValue({ success: true, data: { token: "share-token" } });
    render(<TeamApplicationFlow {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "生成并复制邀请链接" }));

    await waitFor(() => expect(createTeamApplicationJoinLinkMock).toHaveBeenCalledWith({ applicationId: "app-1", regenerate: false }));
  });
});
