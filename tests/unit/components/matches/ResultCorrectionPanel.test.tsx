/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMatchResultCorrection,
  planMatchResultCorrection,
  recordMatchRecoveryAdjudication,
} from "@/actions/matches/corrections";
import { ResultCorrectionPanel } from "@/components/matches/ResultCorrectionPanel";
import { ok } from "@/types/action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/matches/corrections", () => ({
  applyMatchResultCorrection: vi.fn(),
  planMatchResultCorrection: vi.fn(),
  recordMatchRecoveryAdjudication: vi.fn(),
}));

const mockedPlan = vi.mocked(planMatchResultCorrection);
const mockedApply = vi.mocked(applyMatchResultCorrection);
const mockedAdjudicate = vi.mocked(recordMatchRecoveryAdjudication);

function planFixture(overrides: Partial<{
  winnerChanges: boolean;
  blockedReasons: string[];
  impacts: { label: string }[];
  requiredRecoveryActions: string[];
}> = {}) {
  return {
    current: { scoreA: 0, scoreB: 1, isForfeit: false },
    proposed: { scoreA: 1, scoreB: 0, isForfeit: false },
    winnerChanges: true,
    affectsManagedRun: true,
    impacts: [],
    blockedReasons: [],
    requiredRecoveryActions: [],
    ...overrides,
  };
}

async function fillScores(user: ReturnType<typeof userEvent.setup>) {
  const inputs = screen.getAllByPlaceholderText("比分");
  await user.type(inputs[0]!, "1");
  await user.type(inputs[1]!, "0");
}

beforeEach(() => {
  mockedPlan.mockReset();
  mockedApply.mockReset();
  mockedAdjudicate.mockReset();
});

describe("ResultCorrectionPanel", () => {
  it("plans first and renders the impact inventory before any mutation", async () => {
    const user = userEvent.setup();
    mockedPlan.mockResolvedValue(
      ok(
        planFixture({
          impacts: [
            { label: "第 2 轮及之后的赛程确认将被撤销。" },
            { label: "一场尚未开始的下游比赛将被作废并重建。" },
          ],
          requiredRecoveryActions: ["应用更正前，系统会作废 1 场尚未开始的下游比赛。"],
        }),
      ),
    );
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);

    await fillScores(user);
    await user.click(screen.getByRole("button", { name: "计算影响清单" }));

    await waitFor(() => expect(screen.getByText(/胜者将变更/)).toBeInTheDocument());
    expect(screen.getByText(/第 2 轮及之后的赛程确认将被撤销/)).toBeInTheDocument();
    expect(screen.getByText(/一场尚未开始的下游比赛将被作废并重建/)).toBeInTheDocument();
    expect(screen.queryByText(/finalizedRound|r2-1|scheduled|finalize/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认恢复并应用更正" })).toBeInTheDocument();
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it("shows fail-closed blocks instead of an apply button when refused", async () => {
    const user = userEvent.setup();
    mockedPlan.mockResolvedValue(
      ok(
        planFixture({
          blockedReasons: ["官方名次已经生成，胜者更正被禁止；请使用赛后裁决操作。"],
        }),
      ),
    );
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);

    await fillScores(user);
    await user.click(screen.getByRole("button", { name: "计算影响清单" }));

    await waitFor(() => expect(screen.getByText(/官方名次已经生成/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /应用比分更正/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认恢复/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记录裁决" })).toBeInTheDocument();
  });

  it("applies a non-winner correction directly after review without recovery confirmation", async () => {
    const user = userEvent.setup();
    mockedPlan.mockResolvedValue(
      ok(planFixture({ winnerChanges: false })),
    );
    mockedApply.mockResolvedValue(
      ok({ alreadyApplied: false, winnerChanged: false, invalidatedCount: 0, rolledBackToFinalized: null }),
    );
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);

    await fillScores(user);
    await user.click(screen.getByRole("button", { name: "计算影响清单" }));
    await user.click(await screen.findByRole("button", { name: "应用比分更正" }));

    await waitFor(() => expect(mockedApply).toHaveBeenCalled());
    expect(mockedApply.mock.calls[0]![0]).toBe("match-1");
    expect(mockedApply.mock.calls[0]![1]).toMatchObject({ scoreA: 1, scoreB: 0, confirmRecovery: false });
  });

  it("rejects impossible score input without calling any action", async () => {
    const user = userEvent.setup();
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);
    const inputs = screen.getAllByPlaceholderText("比分");
    await user.type(inputs[0]!, "5");
    await user.type(inputs[1]!, "5");
    await user.click(screen.getByRole("button", { name: "计算影响清单" }));
    expect(mockedPlan).not.toHaveBeenCalled();
  });

  it("records adjudications with a non-empty note", async () => {
    const user = userEvent.setup();
    mockedAdjudicate.mockResolvedValue(ok({ recorded: true }));
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);
    await user.type(
      screen.getByPlaceholderText(/赛后裁决说明/),
      "重赛裁决：结果以重赛为准",
    );
    await user.click(screen.getByRole("button", { name: "记录裁决" }));
    await waitFor(() =>
      expect(mockedAdjudicate).toHaveBeenCalledWith("match-1", "重赛裁决：结果以重赛为准"),
    );
  });

  it("refuses adjudication without a note", async () => {
    const user = userEvent.setup();
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);
    await user.click(screen.getByRole("button", { name: "记录裁决" }));
    expect(mockedAdjudicate).not.toHaveBeenCalled();
  });

  it("keeps the review form when planning fails closed at the boundary", async () => {
    const user = userEvent.setup();
    mockedPlan.mockResolvedValue({
      success: false as const,
      error: { code: "VALIDATION_FAILED", message: "只能修正已结束的比赛结果。" },
    });
    render(<ResultCorrectionPanel matchId="match-1" teamAName="Alpha" teamBName="Beta" format="bo1" />);
    await fillScores(user);
    await user.click(screen.getByRole("button", { name: "计算影响清单" }));
    await waitFor(() => expect(mockedPlan).toHaveBeenCalled());
    expect(screen.queryByText(/胜者将变更/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "计算影响清单" })).toBeInTheDocument());
  });
});
