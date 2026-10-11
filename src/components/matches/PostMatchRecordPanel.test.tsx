import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PostMatchRecordPanel } from "./PostMatchRecordPanel";

const actions = vi.hoisted(() => ({ revoke: vi.fn(), video: vi.fn() }));
vi.mock("@/actions/postmatch", () => ({
  addMatchCommentator: vi.fn(), removeMatchCommentator: vi.fn(), submitPostMatchReport: vi.fn(),
  revokePostMatchSubmission: actions.revoke, updateMatchVideoUrl: actions.video,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  actions.revoke.mockResolvedValue({ success: true });
  actions.video.mockResolvedValue({ success: true });
});

it("keeps submitted video editing available and requires explicit reopening confirmation with an optional reason", async () => {
  const user = userEvent.setup();
  render(<PostMatchRecordPanel matchId="match-1" data={{
    commentators: [{ userId: "admin-1", name: "解说甲", hasLiveStream: false }],
    seasonAdmins: [], submittedAt: new Date(), submittedByUserId: "admin-1",
    videoUrl: "https://video.example/match", completionLabel: "已完成", canSubmit: true, rosterReopened: false, canConfirm: true,
  }} />);
  await user.click(screen.getByRole("button", { name: "保存录像" }));
  await waitFor(() => expect(actions.video).toHaveBeenCalledWith({ matchId: "match-1", videoUrl: "https://video.example/match" }));
  await user.click(screen.getByRole("button", { name: "更正解说名单" }));
  expect(actions.revoke).not.toHaveBeenCalled();
  expect(screen.getByLabelText("更正原因（选填）")).toBeVisible();
  expect(screen.getByText(/比分、Demo、统计和录像均保留/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(actions.revoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "更正解说名单" }));
  await user.click(screen.getByRole("button", { name: "重开名单" }));
  await waitFor(() => expect(actions.revoke).toHaveBeenCalledExactlyOnceWith({ matchId: "match-1", reason: "" }));
});

it("defaults to the registered roster without a repeated submission and preserves correction permissions", () => {
  const data = { commentators: [{ userId: "admin-1", name: "解说甲", hasLiveStream: false }],
    seasonAdmins: [], submittedAt: null, submittedByUserId: null, videoUrl: "https://video.example/match",
    completionLabel: "已完成", canSubmit: true, rosterReopened: false, canConfirm: false };
  const { rerender } = render(<PostMatchRecordPanel matchId="match-1" data={data} />);
  expect(screen.queryByRole("button", { name: "确认名单更正" })).toBeNull();
  expect(screen.getByRole("button", { name: "更正解说名单" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "×" })).toBeNull();
  rerender(<PostMatchRecordPanel matchId="match-1" data={{ ...data, rosterReopened: true, completionLabel: "待更正解说名单" }} />);
  expect(screen.getByRole("button", { name: "确认名单更正" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "×" })).toBeVisible();
});
