/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamRecruitmentSection } from "@/components/recruitment/TeamRecruitmentSection";

const { refreshMock, saveTeamRecruitmentMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  saveTeamRecruitmentMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/actions/recruitment", () => ({
  closeTeamRecruitment: vi.fn(),
  dismissRecruitmentInterest: vi.fn(),
  saveTeamRecruitment: saveTeamRecruitmentMock,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("TeamRecruitmentSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveTeamRecruitmentMock.mockResolvedValue({ success: true });
  });

  it("stops presenting an invalid target as public and lets the captain republish with a current target", async () => {
    render(<TeamRecruitmentSection
      team={{ id: "team-1", slug: "rival-team" }}
      isCaptain
      recruitment={{ id: "intent-1", positions: ["awper"], targetSeasonId: "voting-season", targetSeasonName: "已进入投票", note: null, status: "open", expiresAt: "2026-09-30T00:00:00.000Z", isPubliclyActive: false }}
      targetSeasons={[{ id: "registration-season", name: "仍可报名" }]}
      interests={[]}
    />);

    expect(screen.getByText("当前招募已停止公开")).toBeInTheDocument();
    expect(screen.getByText("原目标赛事已不再处于可组队阶段，请选择新的目标赛事后重新发布。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "在组队大厅查看" })).not.toBeInTheDocument();
    const selector = screen.getByLabelText("目标赛事") as HTMLSelectElement;
    expect(selector.value).toBe("");
    expect(screen.queryByRole("option", { name: "已进入投票" })).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "registration-season" } });
    fireEvent.click(screen.getByRole("button", { name: "重新发布招募" }));

    await waitFor(() => expect(saveTeamRecruitmentMock).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-1", targetSeasonId: "registration-season" })));
  });
});
