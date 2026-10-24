import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ add: vi.fn(), retry: vi.fn(), refresh: vi.fn() }));
vi.mock("@/actions/postmatch", () => ({ addMatchCommentator: mocks.add, retryPostMatchRefresh: mocks.retry,
 removeMatchCommentator: vi.fn(), revokePostMatchSubmission: vi.fn(), submitPostMatchReport: vi.fn(), updateMatchVideoUrl: vi.fn() }));
vi.mock("@/components/matches/MatchRecordingEditor", () => ({ MatchRecordingEditor: () => null }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, work: unknown) => work }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PostMatchRecordPanel, type PostMatchRecordData } from "@/components/matches/PostMatchRecordPanel";
const data: PostMatchRecordData = { commentators: [], seasonAdmins: [{ userId: "admin", name: "Fixture", hasLiveStream: false }], submittedAt: null,
 submittedByUserId: null, rosterReopened: false, canConfirm: false, videoUrl: null, recordings: [], completionLabel: "", canSubmit: false };
beforeEach(() => vi.clearAllMocks());
it("shows committed refresh-pending and retries only invalidation", async () => {
 mocks.add.mockResolvedValue({ success: true, data: { refreshPending: true } }); mocks.retry.mockResolvedValue({ success: true });
 const user = userEvent.setup();render(<PostMatchRecordPanel matchId="match" data={data} />);
 await user.click(screen.getByRole("button", { name: "添加 Fixture（无直播间）" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("操作已提交");
 await user.click(screen.getByRole("button", { name: "重试刷新（不重复提交）" }));
 await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
 expect(mocks.add).toHaveBeenCalledOnce(); expect(mocks.retry).toHaveBeenCalledExactlyOnceWith("match");
});
it("keeps an unknown postmatch command blocked without replay", async () => {
 mocks.add.mockRejectedValue(new TypeError("lost response")); const user = userEvent.setup();render(<PostMatchRecordPanel matchId="match" data={data} />);
 const add = screen.getByRole("button", { name: "添加 Fixture（无直播间）" }); await user.click(add);
 expect(await screen.findByRole("alert")).toHaveTextContent("不要重复提交");expect(add).toBeDisabled();await user.click(add);expect(mocks.add).toHaveBeenCalledOnce();
});
