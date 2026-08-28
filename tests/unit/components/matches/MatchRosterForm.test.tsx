/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";

const { submitMatchRosterMock, toastSuccessMock } = vi.hoisted(() => ({
  submitMatchRosterMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/actions/matches/roster", () => ({ submitMatchRoster: submitMatchRosterMock }));
vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: vi.fn() } }));

const members = Array.from({ length: 6 }, (_, index) => ({
  id: `member-${index + 1}`,
  steamName: `steam-${index + 1}`,
  displayName: `Player ${index + 1}`,
  perfectName: null,
  primaryPosition: "rifler",
}));

function renderForm(overrides: Partial<React.ComponentProps<typeof MatchRosterForm>> = {}) {
  return render(
    <MatchRosterForm
      matchId="match-1"
      teamMembers={members}
      hasExistingRoster={false}
      matchStatus="scheduled"
      rosterStatus={null}
      {...overrides}
    />,
  );
}

describe("MatchRosterForm lifecycle gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitMatchRosterMock.mockResolvedValue({ success: true });
  });

  it("keeps the roster editable while the authoritative match is scheduled", () => {
    renderForm();

    expect(screen.getAllByRole("button", { name: /Player 1/ })[0]).toBeEnabled();
    expect(screen.getByText(/比赛尚未开始。提交后由管理员确认/)).toBeInTheDocument();
  });

  it("locks edits from the persisted match lifecycle, independent of wall-clock time", () => {
    renderForm({ matchStatus: "in_progress", rosterStatus: "submitted", hasExistingRoster: true });

    expect(screen.getByText("比赛已开始，名单不可修改")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Player 1/ })[0]).toBeDisabled();
    expect(screen.queryByRole("button", { name: "提交名单" })).not.toBeInTheDocument();
  });

  it("restores the submitted lineup after a page refresh", () => {
    renderForm({
      hasExistingRoster: true,
      rosterStatus: "submitted",
      initialStarterIds: ["member-1", "member-2", "member-3", "member-4", "member-5"],
    });

    expect(screen.getByText("已选 5/5 名首发")).toBeInTheDocument();
  });

  it("locks a scheduled roster only after the persisted roster is confirmed", () => {
    renderForm({ rosterStatus: "confirmed", hasExistingRoster: true });

    expect(screen.getByText("名单已由管理员确认")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Player 1/ })[0]).toBeDisabled();
    expect(screen.getByText("名单已确认，等待比赛开始")).toBeInTheDocument();
  });

  it("submits the selected five starters and optional substitute", async () => {
    renderForm();

    for (let index = 1; index <= 5; index += 1) {
      fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`Player ${index}`) })[0]);
    }
    fireEvent.click(screen.getAllByRole("button", { name: /Player 6/ })[1]);

    fireEvent.click(screen.getByRole("button", { name: "提交名单" }));

    await waitFor(() => expect(submitMatchRosterMock).toHaveBeenCalledWith("match-1", {
      starterIds: ["member-1", "member-2", "member-3", "member-4", "member-5"],
      substituteIds: ["member-6"],
    }));
    expect(toastSuccessMock).toHaveBeenCalledWith("名单提交成功");
  });
});
