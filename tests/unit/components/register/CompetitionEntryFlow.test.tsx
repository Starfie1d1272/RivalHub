import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { CompetitionEntryFlow } from "@/components/register/CompetitionEntryFlow";
import { getCompetitionEntryCapabilities } from "@/lib/competition-entries/capabilities";

vi.mock("@/actions/competition-entries", () => ({
  confirmCompetitionEntryParticipation: vi.fn(), createCompetitionEntry: vi.fn(), declineCompetitionEntryParticipation: vi.fn(), requestCompetitionEntryRosterChange: vi.fn(), saveCompetitionEntryRoster: vi.fn(), submitCompetitionEntry: vi.fn(), transferCompetitionEntryRepresentative: vi.fn(), withdrawCompetitionEntryFromReview: vi.fn(), withdrawCompetitionEntryParticipation: vi.fn(),
}));
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
const season = { status: "registration" as const, registrationOpensAt: new Date("2026-01-01"), registrationOpenedAt: new Date("2026-01-01"), registrationClosesAt: new Date("2027-01-01") };
function props(size = 5): Parameters<typeof CompetitionEntryFlow>[0] {
  const roster = Array.from({ length: size }, (_, i) => ({ membershipId: `m${i}`, userId: `u${i}`, participantId: `p${i}`, label: `选手${i}`, status: "active" as const, roles: [], primaryRole: null, confirmation: "confirmed" as const, primary: i < 5 }));
  return { competitionId: "event", competitionName: "Major", currentUserId: "u0", minRoster: 5, maxRoster: 9, starterCount: 5, requiresCompetitiveProfile: false, requiresTeamLogo: true, canManageEntryTeamProfile: true, approvedTeamCount: 0, registrationWindowCanSubmit: true, rosterChangeClosesAtLabel: "2026-09-27 20:00", captainedTeams: [], invitationConflict: null, capabilities: getCompetitionEntryCapabilities({ season, entry: { status: "draft", hasApprovedRoster: false }, revision: { status: "draft", origin: "initial" }, rosterFrozen: false }), entry: { id: "entry", name: "队伍", status: "draft", logoUrl: "/logo.png", teamLogoUrl: null, representativeUserId: "u0", reviewReason: null, qualificationFindings: [], roster, candidates: roster } };
}
describe("CompetitionEntryFlow", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    refreshMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  it("refreshes readiness manually and only auto-refreshes after 30 seconds away", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00-07:00"));
    render(<CompetitionEntryFlow {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    vi.advanceTimersByTime(29_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    vi.advanceTimersByTime(2_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("deep-links an exact competitive season and does not repeat its aggregate finding", () => {
    const p = props();
    p.requiresCompetitiveProfile = true;
    const finding = { code: "competitive_profile_incomplete", message: "缺少perfect_world · 2026s1 的最高段位及 Rating。", waivable: false, metadata: { field: "reference_season_peak", platform: "perfect_world", seasonKey: "2026s1" } };
    for (const member of p.entry!.roster) {
      member.readiness = { ready: true, blockers: [], findings: [], educationApproved: true, educationState: "ready" };
    }
    p.entry!.roster[0]!.readiness = { ready: false, blockers: [finding.message], findings: [finding], educationApproved: true, educationState: "ready" };
    p.entry!.qualificationFindings = [finding];

    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("选手0 · 需要本人补充 · PW 2026 S1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往" })).toHaveAttribute("href", "/settings/competitive?platform=perfect_world&season=2026s1");
    expect(screen.getAllByText(finding.message)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });

  it("presents pending education as waiting for the organizer while keeping the hard gate closed", () => {
    const p = props();
    p.requiresCompetitiveProfile = true;
    for (const member of p.entry!.roster) {
      member.readiness = { ready: true, blockers: [], findings: [], educationApproved: true, educationState: "ready" };
    }
    const finding = { code: "education_incomplete", message: "高校认证审核中 · 等待赛委会", waivable: false, metadata: { field: "approved_education", state: "pending_review" } };
    p.entry!.roster[0]!.readiness = { ready: false, blockers: [finding.message], findings: [finding], educationApproved: false, educationState: "pending_review" };

    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("选手0 · 高校认证审核中 · 等待赛委会")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往" })).toHaveAttribute("href", "/settings/education");
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });

  it("uses capability truth for closed initial drafts, roster changes, and submitted entries", () => {
    const closed = props();
    closed.registrationWindowCanSubmit = false;
    closed.capabilities.canEditCurrentRoster = false;
    closed.capabilities.canSubmitForReview = false;
    closed.capabilities.readOnlyReason = "报名已截止";
    const { unmount } = render(<CompetitionEntryFlow {...closed} />);
    expect(screen.getByText("队伍 · 首次报名已截止 · 当前报名未在截止前提交")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
    unmount();

    const changing = props();
    changing.entry!.status = "changes_requested";
    changing.entry!.revisionOrigin = "self_roster_change";
    changing.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "changes_requested", hasApprovedRoster: true }, revision: { status: "draft", origin: "self_roster_change" }, rosterFrozen: false });
    const second = render(<CompetitionEntryFlow {...changing} />);
    expect(screen.getByText("队伍 · 名单调整中 · 可修改并重新提交至 2026-09-27 20:00")).toBeInTheDocument();
    second.unmount();

    const submitted = props();
    submitted.entry!.status = "submitted";
    submitted.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "submitted", hasApprovedRoster: false }, revision: { status: "submitted", origin: "initial" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...submitted} />);
    expect(screen.getByText("队伍 · 已提交 · 等待赛委会审核")).toBeInTheDocument();
  });

  it("makes missing logo actionable and blocks review submission", () => {
    const p = props(); p.entry!.logoUrl = null; render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "前往我的队伍上传图标" })).toHaveAttribute("href", "/my/teams#team-profile");
  });
  it("does not offer a dead-end logo editor link to a representative who is not the team captain", () => {
    const p = props(); p.entry!.logoUrl = null; p.canManageEntryTeamProfile = false; render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "前往我的队伍上传图标" })).not.toBeInTheDocument();
    expect(screen.getByText("队伍图标未上传：请联系当前队长在“我的队伍”中上传，再保存本届名单")).toBeInTheDocument();
    expect(screen.getByText("队伍图标尚未上传，请联系当前队长在“我的队伍”中上传后，再保存本届名单。")).toBeInTheDocument();
  });
  it("keeps a newly uploaded Team logo blocked until the event snapshot is saved", () => {
    const p = props(); p.entry!.logoUrl = null; p.entry!.teamLogoUrl = "https://storage.test/current.png";
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("队伍图标已更新，请保存本届名单以用于本届赛事")).toBeInTheDocument();
    expect(screen.getByText(/点击下方“保存本届名单”完成本届快照/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });
  it("asks a non-captain to contact the current captain when only the Team logo is current", () => {
    const p = props(); p.entry!.logoUrl = null; p.entry!.teamLogoUrl = "https://storage.test/current.png"; p.canManageEntryTeamProfile = false;
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("队伍图标已更新，请联系当前队长保存本届名单以用于本届赛事。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "前往我的队伍上传图标" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });
  it("does not show Perfect Team ID in the standard registration flow", () => {
    const p = props(); p.requiresTeamLogo = false; p.entry!.logoUrl = null; render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeEnabled();
    expect(screen.queryByLabelText("完美战队 ID（可选）")).not.toBeInTheDocument();
    expect(screen.queryByText(/完美战队 ID/)).not.toBeInTheDocument();
    expect(screen.queryByText(/赛事专属/)).not.toBeInTheDocument();
  });
  it("only offers review withdrawal for a submitted entry", () => {
    const draft = props(); render(<CompetitionEntryFlow {...draft} />);
    expect(screen.queryByRole("button", { name: "撤回审核" })).not.toBeInTheDocument();

    const submitted = props();
    submitted.entry!.status = "submitted";
    submitted.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "submitted", hasApprovedRoster: false }, revision: { status: "submitted", origin: "initial" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...submitted} />);
    expect(screen.getByRole("button", { name: "撤回审核" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "撤回报名" })).not.toBeInTheDocument();
  });
  it.each([5, 8, 9])("only suggests more substitutes when roster %i has space", (size) => {
    render(<CompetitionEntryFlow {...props(size)} />);
    expect(!!screen.queryByText(/已满足最低人数/)).toBe(size < 9);
  });
  it("makes a confirmed roster removal explicit during a self-service change", () => {
    const p = props();
    p.entry!.status = "changes_requested";
    p.entry!.revisionOrigin = "self_roster_change";
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "changes_requested", hasApprovedRoster: true }, revision: { status: "draft", origin: "self_roster_change" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText(/名单变更中/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "从本届名单移除" })[0]!);
    expect(screen.getByText(/从本届名单移除 选手1/)).toBeInTheDocument();
  });
  it("lets a non-representative approved member confirm self-withdrawal without leaving the team", () => {
    const p = props();
    p.currentUserId = "u1";
    p.entry!.status = "approved";
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "退出本届赛事" }));
    expect(screen.getByText("退出只影响本届赛事参赛名单，不会退出你当前的队伍；退出后该队本届名单需要重新调整并再次提交审核。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认退出本届赛事" })).toBeEnabled();
  });
  it("hides the self-withdraw action after the EventRoster is frozen and gives an escalation path", () => {
    const p = props();
    p.currentUserId = "u1";
    p.entry!.status = "approved";
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: true });
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("最终名单已锁定；如需处理名单或参赛状态，请联系赛事管理员。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退出本届赛事" })).not.toBeInTheDocument();
  });
  it("shows the active team's withdrawal path before a pending invitation", () => {
    const p = props();
    p.currentUserId = "u1";
    p.entry!.status = "approved";
    p.invitationConflict = { pendingInvitationCount: 1, latestPendingInvitationName: "新队" };
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("还有来自「新队」的本届参赛邀请待处理")).toBeInTheDocument();
    expect(screen.getByText(/你目前已确认代表「队伍」参加本届赛事。/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出本届赛事" })).toBeEnabled();
    expect(screen.queryByText(/active claim|CompetitionEntry|revision/)).not.toBeInTheDocument();
  });
  it("tells a representative to transfer responsibility before changing teams", () => {
    const p = props();
    p.entry!.status = "approved";
    p.invitationConflict = { pendingInvitationCount: 2, latestPendingInvitationName: "新队" };
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("还有 2 个本届参赛邀请待处理")).toBeInTheDocument();
    expect(screen.getByText(/先在下方把赛事负责人交接给另一位已确认成员/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "交接给 选手1" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "退出本届赛事" })).not.toBeInTheDocument();
  });
  it("keeps a frozen conflict fail closed and points the player to an administrator", () => {
    const p = props();
    p.currentUserId = "u1";
    p.entry!.status = "approved";
    p.invitationConflict = { pendingInvitationCount: 1, latestPendingInvitationName: "新队" };
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: true });
    render(<CompetitionEntryFlow {...p} />);

    expect(screen.getByText("还有来自「新队」的本届参赛邀请待处理")).toBeInTheDocument();
    expect(screen.getAllByText("最终名单已锁定；如需处理名单或参赛状态，请联系赛事管理员。")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "退出本届赛事" })).not.toBeInTheDocument();
  });
  it("preserves recruitment context and the normal creation path", () => {
    const p = props(); p.entry = null; p.captainedTeams = [{ id: "team", name: "队伍" }]; p.capabilities.canStartRegistration = true;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("link", { name: "查看招募中的队伍" })).toHaveAttribute("href", "/teams/recruitment?view=teams&event=event");
    expect(screen.getByRole("button", { name: "开始报名" })).toBeEnabled();
  });
  it("uses the configured capacity for the non-blocking registration reminder", () => {
    const p = props(); p.entry = null; p.approvedTeamCount = 33; p.majorEntrantCapacity = 32; p.captainedTeams = [{ id: "team", name: "队伍" }]; p.capabilities.canStartRegistration = true;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByText(/已有 33 支队伍通过报名审核，仍可继续报名；若最终超过 32 支，将按本届公告安排处理/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始报名" })).toBeEnabled();
  });
  it("shows the 24-team entrant capacity without promising an in-app qualifier", () => {
    const p = props(); p.entry = null; p.approvedTeamCount = 24; p.majorEntrantCapacity = 24; p.captainedTeams = [{ id: "team", name: "队伍" }]; p.capabilities.canStartRegistration = true;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByText(/本届正赛容量为 24 队，仍可继续报名，最终名单由赛事管理员确认/)).toBeInTheDocument();
    expect(screen.queryByText(/资格赛|自动筛选/)).not.toBeInTheDocument();
  });
  it("does not invent Major roster requirements for other templates", () => {
    const p = props(); p.minRoster = 3; p.maxRoster = 6; p.entry = null; p.capabilities.canStartRegistration = true;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.queryByText(/5–9/)).not.toBeInTheDocument();
  });
  it.each(["名单调整已截止；如需处理名单或参赛状态，请联系赛事管理员。", "最终名单已锁定；如需处理名单或参赛状态，请联系赛事管理员。"])("shows %s without a roster-change button", (reason) => {
    const p = props(); p.entry!.status = "approved"; p.capabilities.canEditCurrentRoster = false; p.capabilities.canRequestRosterChange = false; p.capabilities.readOnlyReason = reason;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发起名单变更" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
  });
});
