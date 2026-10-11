import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { FreePredictionMatchDTO } from "@/lib/free-predictions/types";
import type { BetBoard } from "./BetBoard";
import { UnifiedBetBoard } from "./UnifiedBetBoard";

const mocks = vi.hoisted(() => ({ read: vi.fn(), submit: vi.fn(), board: null as ComponentProps<typeof BetBoard> | null }));
vi.mock("@/actions/free-predictions", () => ({ getFreePredictionBoard: mocks.read, submitFreePrediction: mocks.submit }));
vi.mock("@/actions/bet", () => ({ getBetRelief: vi.fn(), claimBetRelief: vi.fn() }));
vi.mock("./BetBoard", () => ({ BetBoard: (props: ComponentProps<typeof BetBoard>) => { mocks.board = props; return null; } }));
const match: FreePredictionMatchDTO = { matchId: "match", status: "scheduled", isForfeit: false, a: "甲", b: "乙", logoA: null, logoB: null, stage: "测试", scheduledAt: null, entryIds: ["a", "b"], format: "bo1", mapPool: ["de_nuke"], result: { locked: false, canSubmit: true, restriction: null, mine: null, grade: null, support: { total: 0, counts: [0, 0], percentages: null } }, bp: { locked: false, canSubmit: true, restriction: null, mine: null, grade: null, support: { total: 0, maps: [] } } };
const boardResult = (row = match) => ({ success: true, data: { seasonId: "season", matches: [row] } });
const mount = () => render(<UnifiedBetBoard initial={{ seasonId: "season" } as ComponentProps<typeof BetBoard>["initial"]} slug="test" signedIn view="open" matchFilter={null} freeMatches={[match]} reliefModel={{ day: "2026-10-11", canClaim: false, reason: "disabled", amount: "0", granted: "0", remaining: "100" }}/>);
const winner = () => mocks.board!.predictions![0]!;

beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(boardResult()); mocks.submit.mockResolvedValue({ success: true, data: { choiceId: "choice", replayed: false } }); });
describe("canonical prediction action wiring", () => {
  it("ends a confirmed mutation intent even if its first read fails, so A→B→A uses new request IDs", async () => {
    mount();
    mocks.read.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "读失败" } });
    await act(async () => { await mocks.board!.predictionControls!.submitAction(winner(), ["a"]); });
    await act(async () => { await mocks.board!.predictionControls!.refreshAction(winner()); });
    await act(async () => { await mocks.board!.predictionControls!.submitAction(winner(), ["b"]); });
    await act(async () => { await mocks.board!.predictionControls!.submitAction(winner(), ["a"]); });
    expect(new Set(mocks.submit.mock.calls.map(call => call[0].requestId)).size).toBe(3);
  });
  it("ignores an old poll response arriving after a fresh submitted and locked state", async () => {
    mount();
    let finish!: (value: ReturnType<typeof boardResult>) => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    const locked: FreePredictionMatchDTO = { ...match, result: { ...match.result, mine: "a", locked: true, canSubmit: false, restriction: { code: "started", message: "已开始" } } };
    mocks.read.mockResolvedValueOnce(boardResult(locked));
    await act(async () => { await mocks.board!.predictionControls!.submitAction(winner(), ["a"]); });
    await act(async () => { finish(boardResult()); });
    expect(winner().own).toEqual(["a"]);
    expect(winner().canSubmit).toBe(false);
  });
});
