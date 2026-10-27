import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamRegistrationProgress } from "@/components/admin/TeamRegistrationProgress";
import { CompetitionEntryReviewList } from "@/components/admin/CompetitionEntryReviewList";
import { TEAM_REGISTRATION_REVIEW_DEFAULTS, TEAM_REGISTRATION_REVIEW_PAGE_SIZE, type TeamRegistrationReviewRow } from "@/lib/registrations/admin-review-contract";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/admin/test/registrations" }));
vi.mock("@/actions/competition-entries", () => ({ reviewCompetitionEntry: vi.fn(), grantCompetitionEntryRestrictionOverride: vi.fn(), revokeCompetitionEntryRestrictionOverride: vi.fn() }));

const draft: TeamRegistrationReviewRow = {
  id: "entry", name: "队伍", source: "event_native", status: "changes_requested", revisionOrigin: "self_roster_change", revisionStatus: "draft",
  rosterChangeDeadline: "2026-10-20T14:00:00.000Z", rosterChangeWindowOpen: true, rosterChangeDeadlinePassed: false,
  reviewReason: null, perfectTeamId: null, logoUrl: null, updatedAt: "2026-10-19T00:00:00.000Z", representativeName: "负责人",
  minRoster: 5, maxRoster: 9, starterCount: 5, qualificationBlockers: [], qualificationFindings: [], activeRestrictionOverrides: [], members: [],
};
function view(entry: TeamRegistrationReviewRow) {
  return <CompetitionEntryReviewList seasonSlug="test" entries={[entry]} total={1} page={1} pageSize={TEAM_REGISTRATION_REVIEW_PAGE_SIZE} totalPages={1} normalizedQuery={{ ...TEAM_REGISTRATION_REVIEW_DEFAULTS, page: 1, pageSize: TEAM_REGISTRATION_REVIEW_PAGE_SIZE }} hasAnyRecords startedCount={1} draftCount={0} />;
}
describe("管理员名单草稿", () => {
  it("distinguishes initial drafts from roster change drafts in progress", () => {
    render(<TeamRegistrationProgress progress={{ drafts: [], summary: { total: 1, draft: 0, submitted: 0, approved: 0, changesRequested: 0, selfChangeDraft: 1, waitlisted: 0, rejected: 0, withdrawn: 0 } }} />);
    expect(screen.getByText(/首次报名草稿仅供运营观察；名单调整草稿仍列入待处理，等待负责人提交/)).toBeTruthy();
  });
  it("shows the owner and deadline but no review actions; after the deadline directs the owner to the committee", () => {
    const rendered = render(view(draft));
    expect(screen.getByText("草稿待提交", { selector: "div" })).toBeTruthy();
    expect(screen.getByText(/下一步：负责人（负责人）提交新版名单/)).toBeTruthy();
    expect(screen.getByText(/名单调整截止/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "批准" })).toBeNull();
    rendered.rerender(view({ ...draft, rosterChangeWindowOpen: false, rosterChangeDeadlinePassed: true }));
    expect(screen.getByText(/名单调整已截止 · 须联系赛委会/)).toBeTruthy();
    expect(screen.queryByText(/下一步：负责人（负责人）提交/)).toBeNull();
  });
  it("keeps remediation distinct and restores review actions on submitted revisions", () => {
    const rendered = render(view({ ...draft, revisionOrigin: "admin_remediation", reviewReason: "补充材料" }));
    expect(screen.getByText("下一步：待负责人补正")).toBeTruthy();
    expect(screen.getByText("补充材料")).toBeTruthy();
    rendered.rerender(view({ ...draft, status: "submitted", revisionStatus: "submitted" }));
    expect(within(screen.getByRole("button", { name: "批准" })).getByText("批准")).toBeTruthy();
  });
});
