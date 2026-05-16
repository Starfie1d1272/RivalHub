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
      userId: "55555555-5555-4555-8555-555555555555",
      steamName: "Neo",
      perfectName: null,
      displayName: null,
      email: "neo@test.com",
      primaryPosition: "igl",
      secondaryPosition: "anchor",
      peakRank: "S",
      peakRating: 2.01,
      currentRank: "A+",
      currentRating: 2.05,
      mapPreferences: [
        { map: "de_mirage", level: "strong" as const },
        { map: "de_nuke", level: "playable" as const },
        { map: "de_inferno", level: "proficient" as const },
      ],
		gameplayStyle: "进攻型选手",
		notes: null,
		competitionHistory: null,
		createdAt: new Date("2025-01-01T00:00:00Z"),
    },
  ],
  seasonPositions: ["igl", "anchor"],
  rosterMembers: [],
  captainPosition: "igl",
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

    // 桌面端和移动端都会渲染按钮，取第一个
    const [desktopBtn] = screen.getAllByRole("button", { name: /选择 Neo/ });
    await user.click(desktopBtn);

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

    const [desktopBtn] = screen.getAllByRole("button", { name: /Neo 已满/ });

    expect(desktopBtn).toBeDisabled();
    expect(pickPlayerMock).not.toHaveBeenCalled();
  });

  it("links players to their profile pages", () => {
    render(<CaptainDraftPanel {...baseProps} />);

    const [desktopLink] = screen.getAllByRole("link", { name: "Neo" });
    expect(desktopLink).toHaveAttribute(
      "href",
      `/players/${baseProps.players[0].userId}`,
    );
  });
});
