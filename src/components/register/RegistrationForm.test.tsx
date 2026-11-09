import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationForm } from "./RegistrationForm";
import { RIVALS_REGISTRATION_CONFIG } from "@/lib/competition/templates";
import { ErrorCode } from "@/lib/errors";

const actions = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), submit: vi.fn() }));
vi.mock("@/actions/register", () => ({
  loadRegistrationDraft: actions.load,
  saveRegistrationDraft: actions.save,
  submitRegistration: actions.submit,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const open = {
  phase: "open",
  canViewForm: true,
  canSaveDraft: true,
  canSubmit: true,
  needsOpeningRecovery: false,
  message: "报名提交已开放。",
} as const;
const props = {
  seasonId: "6f066ae8-86f6-4248-9143-acfcd4c9562f",
  seasonSlug: "rivals-fixture",
  seasonName: "Rivals 夹具",
  positionCounts: {},
  positions: ["igl", "awper", "opener", "closer", "anchor"],
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  windowState: open,
  currentUserEmail: "rivals-fixture@example.test",
};
const draft = {
  studentId: "fixture-student",
  qq: "10001",
  perfectName: "Rivals fixture",
  steam64: "76561190000000001",
  playerType: "enrolled",
  primaryPosition: "igl",
  secondaryPosition: "anchor",
  peakRank: "A+",
  peakRankSeason: "Fixture S1",
  peakRating: 1.5,
  currentSeasonPeakRank: "A",
  currentRating: 1.3,
  screenshotUrls: [],
  mapPreferences: RIVALS_REGISTRATION_CONFIG.mapPool.map((map) => ({ map, level: "playable" })),
  gameplayStyle: "旧草稿打法",
  antiCheatPledge: true,
};

type LoadResult = { success: true; data: { payload: Record<string, unknown> | null } };
function deferredDraft() {
  let resolve!: (result: LoadResult) => void;
  const promise = new Promise<LoadResult>((settle) => { resolve = settle; });
  return { promise, resolve };
}

it("waits for the current draft before enabling edits and ignores an earlier response", async () => {
  const user = userEvent.setup();
  const earlier = deferredDraft();
  const current = deferredDraft();
  actions.load.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise);
  const view = render(<RegistrationForm {...props} />);
  const gameplay = screen.getByLabelText(/游戏风格自述/);
  expect(gameplay).toBeDisabled();
  expect(screen.getByRole("button", { name: "提交报名" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("正在读取报名草稿");
  await user.type(gameplay, "还不能输入");
  expect(gameplay).toHaveValue("");

  const currentProps = { ...props, currentUserEmail: "another-fixture@example.test" };
  view.rerender(<RegistrationForm {...currentProps} />);
  await act(async () => current.resolve({ success: true, data: { payload: draft } }));
  await waitFor(() => expect(gameplay).toBeEnabled());
  expect(gameplay).toHaveValue("旧草稿打法");
  await user.clear(gameplay);
  await user.type(gameplay, "当前新输入");
  await act(async () => earlier.resolve({ success: true, data: { payload: { gameplayStyle: "过时草稿" } } }));
  expect(gameplay).toHaveValue("当前新输入");
  expect(actions.save).not.toHaveBeenCalled();
  expect(actions.submit).not.toHaveBeenCalled();
});

it("keeps the restored pledge and submission aligned and links to the actual review status", async () => {
  const user = userEvent.setup();
  actions.load.mockResolvedValue({ success: true, data: { payload: draft } });
  actions.submit
    .mockResolvedValueOnce({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: "输入校验失败，请检查各字段",
        fieldErrors: { gameplayStyle: "请补充你擅长的打法" },
      },
    })
    .mockResolvedValueOnce({ success: true, data: { registrationId: "fixture" } });
  render(<RegistrationForm {...props} />);
  const pledge = screen.getByRole("checkbox", { name: /反作弊承诺/ });
  const submit = screen.getByRole("button", { name: "提交报名" });
  await waitFor(() => expect(submit).toBeEnabled());
  expect(pledge).toBeChecked();
  await user.click(pledge);
  await user.click(submit);
  expect(await screen.findByText("请勾选反作弊承诺方可提交")).toBeVisible();
  expect(pledge).toHaveFocus();
  expect(actions.submit).not.toHaveBeenCalled();

  await user.click(pledge);
  await user.click(submit);
  const gameplay = screen.getByLabelText(/游戏风格自述/);
  expect(await screen.findByText("请补充你擅长的打法")).toBeVisible();
  expect(gameplay).toHaveAccessibleDescription("请补充你擅长的打法");
  expect(gameplay).toHaveAttribute("aria-invalid", "true");
  expect(gameplay).toHaveFocus();
  expect(gameplay).toHaveValue(draft.gameplayStyle);
  expect(actions.submit).toHaveBeenLastCalledWith(expect.objectContaining({ antiCheatPledge: true }));

  await user.type(gameplay, "和队伍沟通道具");
  await user.click(submit);
  expect(await screen.findByRole("heading", { name: "报名已提交" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "查看报名进度" })).toHaveAttribute("href", "/rivals-fixture/register#registration-status");
});

it("reads no draft in a closed window and makes the visible fields read-only", () => {
  render(
    <RegistrationForm
      {...props}
      initialValues={{ gameplayStyle: "已提交的打法" }}
      windowState={{ ...open, phase: "closed", canSaveDraft: false, canSubmit: false }}
    />,
  );
  const gameplay = screen.getByLabelText(/游戏风格自述/);
  expect(gameplay).toBeDisabled();
  expect(gameplay).toHaveValue("已提交的打法");
  expect(screen.queryByRole("button", { name: "保存草稿" })).toBeNull();
  expect(screen.queryByRole("button", { name: "提交报名" })).toBeNull();
  expect(actions.load).not.toHaveBeenCalled();
});

it("lets the participant retry a failed draft read before entering the form", async () => {
  const user = userEvent.setup();
  actions.load
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce({ success: true, data: { payload: null } });
  render(<RegistrationForm {...props} />);
  const retry = await screen.findByRole("button", { name: "重新读取草稿" });
  const gameplay = screen.getByLabelText(/游戏风格自述/);
  expect(gameplay).toBeDisabled();
  await user.click(retry);
  await waitFor(() => expect(gameplay).toBeEnabled());
  expect(actions.load).toHaveBeenCalledTimes(2);
});
