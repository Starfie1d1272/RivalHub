import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { CompetitionEntryFlow } from "@/components/register/CompetitionEntryFlow";
import { getCompetitionEntryCapabilities } from "@/lib/competition-entries/capabilities";

vi.mock("@/actions/competition-entries", () => ({
  confirmCompetitionEntryParticipation: vi.fn(), createCompetitionEntry: vi.fn(), declineCompetitionEntryParticipation: vi.fn(), requestCompetitionEntryRosterChange: vi.fn(), saveCompetitionEntryRoster: vi.fn(), submitCompetitionEntry: vi.fn(), transferCompetitionEntryRepresentative: vi.fn(), withdrawCompetitionEntry: vi.fn(), withdrawCompetitionEntryParticipation: vi.fn(),
}));
const season = { status: "registration" as const, registrationOpensAt: new Date("2026-01-01"), registrationOpenedAt: new Date("2026-01-01"), registrationClosesAt: new Date("2027-01-01") };
function props(size = 5): Parameters<typeof CompetitionEntryFlow>[0] {
  const roster = Array.from({ length: size }, (_, i) => ({ membershipId: `m${i}`, userId: `u${i}`, participantId: `p${i}`, label: `选手${i}`, status: "active" as const, roles: [], primaryRole: null, confirmation: "confirmed" as const, primary: i < 5 }));
  return { competitionId: "event", competitionName: "Major", currentUserId: "u0", minRoster: 5, maxRoster: 9, starterCount: 5, requiresPerfectTeamId: false, requiresTeamLogo: true, approvedTeamCount: 0, captainedTeams: [], capabilities: getCompetitionEntryCapabilities({ season, entry: { status: "draft", hasApprovedRoster: false }, revision: { status: "draft", origin: "initial" }, rosterFrozen: false }), entry: { id: "entry", name: "队伍", status: "draft", logoUrl: "/logo.png", representativeUserId: "u0", perfectTeamId: null, reviewReason: null, qualificationFindings: [], roster, candidates: roster } };
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
    fireEvent.change(screen.getByLabelText("赛事专属队伍 ID"), { target: { value: "123" } });
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(screen.getByText(/有未保存的修改/)).toBeInTheDocument();
  });
  it.each([5, 8, 9])("only suggests more substitutes when roster %i has space", (size) => {
    render(<CompetitionEntryFlow {...props(size)} />);
    expect(!!screen.queryByText(/已满足最低人数/)).toBe(size < 9);
  });
  it("preserves recruitment context and the normal creation path", () => {
    const p = props(); p.entry = null; p.captainedTeams = [{ id: "team", name: "队伍" }]; p.capabilities.canStartRegistration = true;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByRole("link", { name: "查看招募中的队伍" })).toHaveAttribute("href", "/teams/recruitment?event=event");
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
  it.each(["名单调整已截止", "最终名单已锁定"])("shows %s without a roster-change button", (reason) => {
    const p = props(); p.entry!.status = "approved"; p.capabilities.canEditCurrentRoster = false; p.capabilities.canRequestRosterChange = false; p.capabilities.readOnlyReason = reason;
    render(<CompetitionEntryFlow {...p} />);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "申请修改名单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
  });
});
