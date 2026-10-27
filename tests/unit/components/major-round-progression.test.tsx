import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MajorSwissRuntimeManagement } from "@/components/admin/MajorSwissRuntimeManagement";
import { MajorPlayoffRuntimeManagement } from "@/components/admin/MajorPlayoffRuntimeManagement";

const actions = vi.hoisted(() => ({ swiss: vi.fn(), playoff: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("@/actions/major-prestart", () => ({ finalizeMajorSwissRound: actions.swiss, finalizeMajorPlayoffRound: actions.playoff, startMajorPlayoff: vi.fn(), transitionMajorSwissStage: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const swiss = { seasonId: "season", stageRunId: "run", stageKey: "swiss", stageName: "Swiss", finalizedRound: 0, currentRound: 1, currentMatchCount: 2, completedMatchCount: 1, stageComplete: false, nextStageName: null, nextStageType: null } as const;
const playoff = { seasonId: "season", stageRunId: "run", currentRound: "quarterfinal", currentMatchCount: 4, completedMatchCount: 3, resultPendingConfirmation: false } as const;

it("requires completed Swiss matches and explicit confirmation before invoking the canonical action", async () => {
  const view = render(<MajorSwissRuntimeManagement data={swiss} />);
  expect(screen.getByRole("button", { name: "确认本轮并生成下一轮" })).toBeDisabled();
  view.rerender(<MajorSwissRuntimeManagement data={{ ...swiss, completedMatchCount: 2 }} />);
  expect(screen.getByRole("button", { name: "确认本轮并生成下一轮" })).toBeDisabled();
  actions.swiss.mockResolvedValue({ success: true, data: { alreadyFinalized: true } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认本轮并生成下一轮" }));
  await waitFor(() => expect(actions.swiss).toHaveBeenCalledWith({ seasonId: "season", stageRunId: "run", expectedRound: 1 }));
});

it("requires completed playoff matches and explicit confirmation before invoking the canonical action", async () => {
  const view = render(<MajorPlayoffRuntimeManagement data={playoff} />);
  expect(screen.getByRole("button", { name: "确认八强赛" })).toBeDisabled();
  view.rerender(<MajorPlayoffRuntimeManagement data={{ ...playoff, completedMatchCount: 4 }} />);
  expect(screen.getByRole("button", { name: "确认八强赛" })).toBeDisabled();
  actions.playoff.mockResolvedValue({ success: true, data: { alreadyFinalized: true } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认八强赛" }));
  await waitFor(() => expect(actions.playoff).toHaveBeenCalledWith({ seasonId: "season", stageRunId: "run", expectedRound: "quarterfinal" }));
});
