import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { CompetitionEntryFlow } from "@/components/register/CompetitionEntryFlow";
import { getCompetitionEntryCapabilities } from "@/lib/competition-entries/capabilities";

vi.mock("@/actions/competition-entries", () => ({
  confirmCompetitionEntryParticipation: vi.fn(), createCompetitionEntry: vi.fn(), declineCompetitionEntryParticipation: vi.fn(), requestCompetitionEntryRosterChange: vi.fn(), saveCompetitionEntryRoster: vi.fn(), submitCompetitionEntry: vi.fn(), transferCompetitionEntryRepresentative: vi.fn(), withdrawCompetitionEntryFromReview: vi.fn(), withdrawCompetitionEntryParticipation: vi.fn(),
}));
const season = { status: "registration" as const, registrationOpensAt: new Date("2026-01-01"), registrationOpenedAt: new Date("2026-01-01"), registrationClosesAt: new Date("2027-01-01") };
function props(size = 5): Parameters<typeof CompetitionEntryFlow>[0] {
  const roster = Array.from({ length: size }, (_, i) => ({ membershipId: `m${i}`, userId: `u${i}`, participantId: `p${i}`, label: `选手${i}`, status: "active" as const, roles: [], primaryRole: null, confirmation: "confirmed" as const, primary: i < 5 }));
  return { competitionId: "event", competitionName: "Major", currentUserId: "u0", minRoster: 5, maxRoster: 9, starterCount: 5, requiresCompetitiveProfile: false, requiresTeamLogo: true, approvedTeamCount: 0, captainedTeams: [], invitationConflict: null, capabilities: getCompetitionEntryCapabilities({ season, entry: { status: "draft", hasApprovedRoster: false }, revision: { status: "draft", origin: "initial" }, rosterFrozen: false }), entry: { id: "entry", name: "队伍", status: "draft", logoUrl: "/logo.png", representativeUserId: "u0", reviewReason: null, qualificationFindings: [], roster, candidates: roster } };
}
describe("CompetitionEntryFlow", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  it("makes missing logo actionable and blocks review submission", () => {
    const p = props(); p.entry!.logoUrl = null; render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "前往我的队伍上传图标" })).toHaveAttribute("href", "/my/teams#team-profile");
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
  it("uses the approved count for the non-blocking qualifier reminder", () => {
    const p = props(); p.entry = null; p.approvedTeamCount = 33; p.captainedTeams = [{ id: "team", name: "队伍" }]; p.capabilities.canStartRegistration = true;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByText(/已有 33 支队伍通过报名审核/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始报名" })).toBeEnabled();
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
