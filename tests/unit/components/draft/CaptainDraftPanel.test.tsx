import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptainDraftPanel } from "@/components/draft/CaptainDraftPanel";
import { pickPlayer } from "@/actions/draft";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/actions/draft", () => ({
  pickPlayer: vi.fn(),
}));

const pickPlayerMock = vi.mocked(pickPlayer);

const baseProps = {
  seasonId: "11111111-1111-4111-8111-111111111111",
  teamId: "22222222-2222-4222-8222-222222222222",
  teamName: "Alpha 队",
  currentTeamName: "Alpha 队",
  currentRound: 2,
  roundDeadline: "2026-05-11T12:03:00.000Z",
  isDraftActive: true,
  isCurrentCaptainTurn: true,
  positionCounts: { igl: 1 },
  players: [
    {
      registrationId: "33333333-3333-4333-8333-333333333333",
      steamName: "Neo",
      primaryPosition: "igl",
      secondaryPosition: "anchor",
      peakRank: "S",
      peakRating: 2.01,
      mapPreferences: [
        { map: "de_mirage", level: "strong" as const },
        { map: "de_nuke", level: "playable" as const },
        { map: "de_inferno", level: "proficient" as const },
      ],
    },
  ],
  seasonPositions: ["igl", "anchor"],
};

describe("CaptainDraftPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickPlayerMock.mockResolvedValue({
      success: true,
      data: { pickId: "pick-1", idempotent: false, completed: false },
    });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("calls pickPlayer with a generated idempotency key when captain selects a player", async () => {
    const user = userEvent.setup();
    render(<CaptainDraftPanel {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /选择 Neo/ }));

    expect(pickPlayerMock).toHaveBeenCalledWith({
      seasonId: baseProps.seasonId,
      teamId: baseProps.teamId,
      registrationId: baseProps.players[0].registrationId,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("disables players whose primary position already reached the team cap", () => {
    render(<CaptainDraftPanel {...baseProps} positionCounts={{ igl: 2 }} />);

    const button = screen.getByRole("button", { name: /Neo 已达上限/ });

    expect(button).toBeDisabled();
    expect(pickPlayerMock).not.toHaveBeenCalled();
  });
});
