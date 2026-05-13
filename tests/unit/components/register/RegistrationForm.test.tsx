import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationForm } from "@/components/register/RegistrationForm";
import { loadRegistrationDraft, saveRegistrationDraft, submitRegistration } from "@/actions/register";
import { RIVALS_REGISTRATION_CONFIG } from "@/types/season";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/actions/register", () => ({
  loadRegistrationDraft: vi.fn(),
  saveRegistrationDraft: vi.fn(),
  submitRegistration: vi.fn(),
}));

const loadRegistrationDraftMock = vi.mocked(loadRegistrationDraft);
const saveRegistrationDraftMock = vi.mocked(saveRegistrationDraft);
const submitRegistrationMock = vi.mocked(submitRegistration);

const baseProps = {
  seasonId: "11111111-1111-4111-8111-111111111111",
  seasonName: "NJU Rivals",
  positionCounts: {},
  positions: ["igl", "awper", "opener", "closer", "anchor"],
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  windowState: {
    phase: "open" as const,
    canViewForm: true,
    canSaveDraft: true,
    canSubmit: true,
    message: "报名提交已开放。",
  },
};

describe("RegistrationForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadRegistrationDraftMock.mockResolvedValue({
      success: true,
      data: { payload: null },
    });
    saveRegistrationDraftMock.mockResolvedValue({
      success: true,
      data: { email: "player@example.com" },
    });
    submitRegistrationMock.mockResolvedValue({
      success: true,
      data: {
        registrationId: "22222222-2222-4222-8222-222222222222",
        email: "player@example.com",
      },
    });
  });

  it("restores draft values into select fields after loading by email", async () => {
    const user = userEvent.setup();
    loadRegistrationDraftMock.mockResolvedValue({
      success: true,
      data: {
        payload: {
          seasonId: baseProps.seasonId,
          email: "player@example.com",
          playerType: "graduated",
          primaryPosition: "awper",
          secondaryPosition: "anchor",
          peakRank: "钻石S",
          currentSeasonPeakRank: "黄金S",
        },
      },
    });

    render(<RegistrationForm {...baseProps} />);

    const email = screen.getByLabelText(/电子邮件/);
    await user.type(email, "player@example.com");
    await user.tab();

    await waitFor(() => {
      expect(loadRegistrationDraftMock).toHaveBeenCalledWith(
        baseProps.seasonId,
        "player@example.com",
      );
    });

    await waitFor(() => {
      const selects = screen.getAllByRole("combobox");
      expect(selects[0]).toHaveTextContent("毕业");
      expect(selects[1]).toHaveTextContent("AWPer（狙击手）");
      expect(selects[2]).toHaveTextContent("Anchor（主防）");
      expect(selects[3]).toHaveTextContent("钻石S");
      expect(selects[4]).toHaveTextContent("黄金S");
    });
  });

  it("shows logged-in email as readonly", async () => {
    render(<RegistrationForm {...baseProps} currentUserEmail="player@example.com" />);

    await waitFor(() => {
      expect(loadRegistrationDraftMock).toHaveBeenCalledWith(
        baseProps.seasonId,
        "player@example.com",
      );
    });
    expect(screen.getByLabelText(/电子邮件/)).toHaveValue("player@example.com");
  });

  it("auto-loads the logged-in user's draft", async () => {
    loadRegistrationDraftMock.mockResolvedValue({
      success: true,
      data: {
        payload: {
          seasonId: baseProps.seasonId,
          email: "player@example.com",
          perfectName: "草稿昵称",
          playerType: "graduated",
        },
      },
    });

    render(<RegistrationForm {...baseProps} currentUserEmail="player@example.com" />);

    await waitFor(() => {
      expect(loadRegistrationDraftMock).toHaveBeenCalledWith(
        baseProps.seasonId,
        "player@example.com",
      );
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/完美平台昵称/)).toHaveValue("草稿昵称");
    });
  });
});
