import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoDataReviewPanel } from "./DemoDataReviewPanel";
import type { AdminDemoReviewMap, AdminDemoReviewParticipant } from "@/lib/admin/matches/types";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), recheckSeason: vi.fn(), recheck: vi.fn(), retire: vi.fn(), reject: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/actions/demo-integration", () => ({ confirmStoredDemoParticipantIdentity: mocks.confirm, recheckSeasonStoredDemoImports: mocks.recheckSeason, recheckStoredDemoImport: mocks.recheck, retireGameplaySteamIdentity: mocks.retire, rejectStoredDemoImport: mocks.reject }));

const participant: AdminDemoReviewParticipant = {
  observedSteam64: "76561198123456789", demoName: "Demo player", teamName: "Alpha", state: "confirmable",
  currentPlayer: null, retirableIdentityId: null, note: null,
  candidates: [{ eventRosterMemberId: "member-a", entryId: "entry-a", name: "选手 A", steam64: "76561198000000001" }],
};
function review(overrides: Partial<AdminDemoReviewMap> = {}): AdminDemoReviewMap {
  return { importId: "import-a", matchMapId: "map-a", mapOrder: 1, mapName: "de_inferno", invalidPayload: false,
    message: "需要处理：1 名选手 Steam 身份未确认", resolvedCount: 9, blockingIssues: [], participants: [participant], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue({ success: true, data: { status: "confirmed" } });
  mocks.recheckSeason.mockResolvedValue({ success: true, data: { attempted: 17, confirmed: 12, remaining: 5, failed: 0, affectedMatchIds: ["match-a"] } });
  mocks.recheck.mockResolvedValue({ success: true, data: { status: "confirmed", importId: "import-a", issues: [] } });
  mocks.retire.mockResolvedValue({ success: true, data: { retired: true } });
  mocks.reject.mockResolvedValue({ success: true, data: {} });
});

describe("DemoDataReviewPanel", () => {
  it("rechecks all current pending Demo imports in the season from one operator action", async () => {
    const user = userEvent.setup();
    render(<DemoDataReviewPanel reviews={[review()]} />);
    await user.click(screen.getByRole("button", { name: "重新检查本赛事全部待处理 Demo" }));
    await waitFor(() => expect(mocks.recheckSeason).toHaveBeenCalledWith({ importId: "import-a" }));
    expect(mocks.success).toHaveBeenCalledWith("本赛事待处理 Demo 已重新检查：共 17 张，确认 12 张，仍需处理 5 张。");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each(["confirmed", "needs_attention"])("rechecks stored evidence against current facts and refreshes for %s", async (status) => {
    mocks.recheck.mockResolvedValue({ success: true, data: { status, importId: "import-a", issues: status === "confirmed" ? [] : [{ code: "ROSTER_PARTICIPANT_MISSING" }] } });
    const user = userEvent.setup();
    render(<DemoDataReviewPanel reviews={[review()]} />);
    await user.click(screen.getByRole("button", { name: "按当前资料重新检查" }));
    await waitFor(() => expect(mocks.recheck).toHaveBeenCalledWith({ importId: "import-a" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith(status === "confirmed"
      ? "已按当前资料重新检查，这份 Demo 已确认并更新统计。"
      : "已按当前资料重新检查，仍有问题需要处理。");
  });

  it("shows an actual-lineup mismatch without Steam identity controls", () => {
    render(<DemoDataReviewPanel reviews={[review({
      message: "需要处理：1 名选手实际出场与本场记录首发不一致",
      participants: [{
        ...participant,
        state: "roster-mismatch",
        currentPlayer: { userId: "sub-user", name: "替补选手" },
        retirableIdentityId: null,
        note: "这个 Steam64 已明确属于本队赛事名单成员，但不在本场记录的首发五人中。这是实际出场名单问题，不是 Steam 身份冲突；请不要改绑或撤销 Steam 身份。",
        candidates: [],
      }],
    })]} />);
    expect(screen.getByText(/实际出场与本场记录首发不一致/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "替补选手" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /撤销比赛确认的 Steam 身份/ })).not.toBeInTheDocument();
  });

  it.each(["confirmed", "needs_attention"])("shows only the unresolved participant and refreshes after %s confirmation", async (status) => {
    mocks.confirm.mockResolvedValue({ success: true, data: { status } });
    const user = userEvent.setup();
    render(<DemoDataReviewPanel reviews={[review()]} />);
    expect(screen.getByText("9 名选手身份已正常匹配")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "请先选择本场首发" })).toBeDisabled();
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: `确认 ${participant.observedSteam64} 是 选手 A` }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.confirm).toHaveBeenCalledWith({ importId: "import-a", observedSteam64: participant.observedSteam64, eventRosterMemberId: "member-a" });
    expect(mocks.success).toHaveBeenCalledWith(status === "confirmed" ? "比赛 Steam 身份已确认，Demo 数据已重新检查。" : "比赛 Steam 身份已保存，但这份 Demo 仍有其他问题需要处理。");
  });

  it("surfaces related Demo fan-out outcomes after identity confirmation", async () => {
    mocks.confirm.mockResolvedValue({
      success: true,
      data: {
        status: "confirmed",
        relatedRechecks: { attempted: 4, confirmed: 2, remaining: 1, failed: 1 },
      },
    });
    const user = userEvent.setup();
    render(<DemoDataReviewPanel reviews={[review()]} />);
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: `确认 ${participant.observedSteam64} 是 选手 A` }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("另外自动确认了 2 张受同一身份影响的 Demo")));
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("另有 1 张相关 Demo 重新检查后仍需处理"));
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("另有 1 张自动重新检查失败"));
  });

  it("requires a reason and explicit confirmation to retire, then refreshes", async () => {
    const user = userEvent.setup();
    render(<DemoDataReviewPanel reviews={[review({ participants: [{ ...participant, state: "conflict-retirable", currentPlayer: { userId: "wrong-user", name: "选手 X" }, retirableIdentityId: "identity-a" }] })]} />);
    expect(screen.getByRole("link", { name: "选手 X" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "撤销比赛确认的 Steam 身份" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("撤销原因（2–500 字）"), "核对后发现关联错误");
    await user.click(button);
    expect(mocks.retire).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.retire).toHaveBeenCalledWith({ identityId: "identity-a", reason: "核对后发现关联错误" });
  });

  it("explains non-retirable conflicts without offering a mutation", () => {
    render(<DemoDataReviewPanel reviews={[review({ participants: [{ ...participant, state: "conflict-nonretirable", currentPlayer: { userId: "wrong-user", name: "选手 X" }, note: "请联系平台管理员核对历史身份。" }] })]} />);
    expect(screen.getByText("请联系平台管理员核对历史身份。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /撤销/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps rejection available without identity controls for invalid=%s", async (invalidPayload) => {
    const user = userEvent.setup();
    const message = invalidPayload ? "这份 Demo 数据无法重新读取，请核对或拒绝。" : "这份 Demo 当前不是 Steam 身份确认问题。";
    render(<DemoDataReviewPanel reviews={[review({ invalidPayload, participants: [], message, resolvedCount: invalidPayload ? 0 : 10,
      blockingIssues: invalidPayload ? [] : ["Demo 回合比分与正式比分不一致，请核对本图赛果。", "DAK QA 未通过，本问题不能通过身份确认解决。"] })]} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    if (!invalidPayload) expect(screen.getByText(/DAK QA 未通过/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "拒绝这份 Demo 数据" }));
    expect(mocks.reject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认拒绝" }));
    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith({ importId: "import-a" }));
  });

  it("keeps a failed confirmation visible without a success or refresh", async () => {
    mocks.confirm.mockResolvedValue({ success: false, error: { message: "身份已变化，请刷新重试。" } });
    const user = userEvent.setup();
    render(<DemoDataReviewPanel reviews={[review()]} />);
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /确认 765/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("身份已变化，请刷新重试。"));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
