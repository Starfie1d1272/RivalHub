import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityAwardAdminControls, CommunityAwardEvidenceReview } from "@/components/community-awards/CommunityAwardAdminControls";
import type { CommunityAwardModel } from "@/lib/community-awards/data";

const actions = vi.hoisted(() => ({ configureCommunityAward: vi.fn(), resolveCommunityAward: vi.fn(), verifyCommunityAwardEvidence: vi.fn() }));
vi.mock("@/actions/community-awards", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const candidates = ["one", "two", "three"].map(id => ({ id, name: `选手-${id}`, playerUserId: id }));
const award: CommunityAwardModel = { id: "award", submittedByUserId: "one", submitterPlayerUserId: "one", name: "社区奖", condition: "按公示规则", prize: "奖品", supplementaryNote: null, publicNote: null, reviewNote: null, status: "approved", outcomeNote: null, submitterName: "发起人", recipientName: null, recipientUserId: null, recipientTarget: null, recipients: [], recipientPolicy: "single", recipientLimit: 1, settlementPolicy: "season_complete", settlementStageKey: null, resultVersion: 4, settlementReady: true };

beforeEach(() => { vi.clearAllMocks(); Object.values(actions).forEach(action => action.mockResolvedValue({ success: true })); });

describe("community award administrator tasks", () => {
  it("keeps singleton awards a single choice and submits the server version", async () => {
    const user = userEvent.setup();
    render(<CommunityAwardAdminControls award={award} candidates={candidates} stages={[]} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "选择获奖者" }), "one");
    await user.type(screen.getByRole("textbox", { name: "结果说明" }), "确认名单");
    await user.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(actions.resolveCommunityAward).toHaveBeenCalledWith({ awardId: "award", status: "awarded", recipientUserIds: ["one"], outcomeNote: "确认名单", expectedVersion: 4 }));
  });
  it("restores the full list for correction and prevents over-limit submissions", async () => {
    const user = userEvent.setup();
    render(<CommunityAwardAdminControls award={{ ...award, status: "awarded", recipientPolicy: "limited", recipientLimit: 2, recipients: [{ userId: "one", name: "甲", target: null }, { userId: "two", name: "乙", target: null }] }} candidates={candidates} stages={[]} />);
    expect(screen.getByRole("checkbox", { name: "选手-one" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选手-two" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "选手-three" }));
    await user.type(screen.getByRole("textbox", { name: "结果说明" }), "更正名单");
    expect(screen.getByRole("button", { name: "保存结果" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "选手-two" }));
    await user.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(actions.resolveCommunityAward).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: ["one", "three"], expectedVersion: 4 })));
  });
  it("keeps an early candidate pending final settlement and permits reasoned cancellation", async () => {
    const user = userEvent.setup();
    render(<CommunityAwardAdminControls award={{ ...award, settlementReady: false }} candidates={candidates} stages={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("已核验候选不等于最终获奖");
    await user.type(screen.getByRole("textbox", { name: "结果说明" }), "运营取消");
    expect(screen.getByRole("button", { name: "保存结果" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "最终结果" }), "cancelled");
    await user.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(actions.resolveCommunityAward).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", recipientUserIds: [] })));
  });
  it("requires a reason before verifying or correcting one evidence item", async () => {
    const user = userEvent.setup();
    render(<CommunityAwardEvidenceReview award={award} item={{ id: "evidence", submittedByUserId: "one", submitterPlayerUserId: "one", candidateUserId: "two", candidatePlayerUserId: "two", submitterName: "甲", candidateName: "乙", matchLabel: null, explanation: "视频证据", videoUrl: null, createdAt: "刚刚", verificationStatus: "pending", verifiedByUserId: null, verifiedByName: null, verifiedAt: null, verificationNote: null }} />);
    expect(screen.getByRole("button", { name: /^符合条件$/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "候选核验或更正理由" }), "录像核对通过");
    await user.click(screen.getByRole("button", { name: /^符合条件$/ }));
    await waitFor(() => expect(actions.verifyCommunityAwardEvidence).toHaveBeenCalledWith({ awardId: "award", evidenceId: "evidence", status: "eligible", note: "录像核对通过", expectedVersion: 4 }));
  });
});
