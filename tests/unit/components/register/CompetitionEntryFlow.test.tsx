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
  return { competitionId: "event", competitionName: "Major", currentUserId: "u0", minRoster: 5, maxRoster: 9, starterCount: 5, requiresCompetitiveProfile: false, showsPerfectTeamId: true, requiresTeamLogo: true, approvedTeamCount: 0, captainedTeams: [], capabilities: getCompetitionEntryCapabilities({ season, entry: { status: "draft", hasApprovedRoster: false }, revision: { status: "draft", origin: "initial" }, rosterFrozen: false }), entry: { id: "entry", name: "队伍", status: "draft", logoUrl: "/logo.png", representativeUserId: "u0", perfectTeamId: null, reviewReason: null, qualificationFindings: [], roster, candidates: roster } };
}
describe("CompetitionEntryFlow", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  it("makes missing logo actionable and blocks review submission", () => {
    const p = props(); p.entry!.logoUrl = null; render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "前往我的队伍上传图标" })).toHaveAttribute("href", "/my/teams");
  });
  it("allows templates without a logo requirement and blocks unsaved edits", () => {
    const p = props(); p.requiresTeamLogo = false; p.entry!.logoUrl = null; render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("button", { name: "提交审核" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("完美战队 ID（可选）"), { target: { value: "123" } });
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(screen.getByText(/有未保存的修改/)).toBeInTheDocument();
  });
  it("keeps the Perfect Team ID optional and explains that it does not block registration", () => {
    const p = props();
    p.requiresCompetitiveProfile = true;
    p.entry!.roster.forEach((member) => { member.readiness = { ready: true, blockers: [], findings: [], educationApproved: true }; });
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByLabelText("完美战队 ID（可选）")).toHaveValue("");
    expect(screen.getByText("如已创建完美战队可填写；未填写不影响报名。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交审核" })).toBeEnabled();
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
  it("lets a non-representative approved member confirm self-withdrawal without leaving the long-lived team", () => {
    const p = props();
    p.currentUserId = "u1";
    p.entry!.status = "approved";
    p.capabilities = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: false });
    render(<CompetitionEntryFlow {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "退出本届赛事" }));
    expect(screen.getByText("退出只影响本届赛事参赛名单，不会退出你的长期队伍；退出后该队本届名单需要重新调整并再次提交审核。")).toBeInTheDocument();
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
