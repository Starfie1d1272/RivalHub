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
    videoUrl: "https://video.example/match", completionLabel: "已完成", canSubmit: true,
  }} />);
  await user.click(screen.getByRole("button", { name: "保存录像" }));
  await waitFor(() => expect(actions.video).toHaveBeenCalledWith({ matchId: "match-1", videoUrl: "https://video.example/match" }));
  await user.click(screen.getByRole("button", { name: "撤销提交 / 重新开放整理" }));
  expect(actions.revoke).not.toHaveBeenCalled();
  expect(screen.getByLabelText("撤销原因（选填）")).toBeVisible();
  expect(screen.getByText(/已有比分、Demo、录像链接和解说名单均保留/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(actions.revoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "撤销提交 / 重新开放整理" }));
  await user.click(screen.getByRole("button", { name: "撤销提交" }));
  await waitFor(() => expect(actions.revoke).toHaveBeenCalledExactlyOnceWith({ matchId: "match-1", reason: "" }));
});
