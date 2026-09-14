/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitionEntryReviewList } from "@/components/admin/CompetitionEntryReviewList";
import { TeamRegistrationProgress } from "@/components/admin/TeamRegistrationProgress";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/major-2026/registrations",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competition-entries", () => ({
  grantCompetitionEntryRestrictionOverride: vi.fn(),
  reviewCompetitionEntry: vi.fn(),
  revokeCompetitionEntryRestrictionOverride: vi.fn(),
}));

const normalizedQuery = {
  status: "submitted" as const,
  qualification: "all" as const,
  sort: "oldest" as const,
  page: 1,
  pageSize: 25 as const,
};

describe("team registration operations presentation", () => {
  beforeEach(() => vi.stubGlobal("React", React));

  it("shows draft progress and bounded blockers without review actions", () => {
    render(<TeamRegistrationProgress progress={{
      drafts: [{
        id: "entry-1",
        name: "Dry Pull & Pray",
        source: "event_native",
        representativeName: "队长甲",
        updatedAt: "2026-09-08T10:00:00.000Z",
        rosterCount: 6,
        minRoster: 5,
        maxRoster: 9,
        confirmedCount: 3,
        starterCount: 4,
        requiredStarterCount: 5,
        primaryBlockers: ["还差 3 名成员确认。", "还差 1 名预定主力。", "队伍图标尚未上传。"],
      }],
      summary: { total: 7, draft: 7, submitted: 0, approved: 0, changesRequested: 0, waitlisted: 0, rejected: 0, withdrawn: 0 },
    }} />);

    expect(screen.getByText("已有 7 支队伍正在填写报名")).toBeInTheDocument();
    expect(screen.getByText("Dry Pull & Pray")).toBeInTheDocument();
    expect(screen.getByText("6/5–9")).toBeInTheDocument();
    expect(screen.getByText("3/6")).toBeInTheDocument();
    expect(screen.getByText("还差 3 名成员确认。", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("还差 1 名预定主力。", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/。；/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "候补" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "要求补正" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
  });

  it("describes drafts-only state as no submitted review work, not no registrations", () => {
    render(<CompetitionEntryReviewList
      seasonSlug="major-2026"
      entries={[]}
      total={0}
      page={1}
      pageSize={25}
      totalPages={0}
      normalizedQuery={normalizedQuery}
      hasAnyRecords={false}
      startedCount={7}
      draftCount={7}
    />);

    expect(screen.getByText("暂时没有队伍提交审核")).toBeInTheDocument();
    expect(screen.getByText("已有 7 支队伍正在填写报名。")).toBeInTheDocument();
    expect(screen.queryByText("暂无赛事报名")).not.toBeInTheDocument();
  });

  it("keeps active review filters distinct from the draft summary", () => {
    render(<CompetitionEntryReviewList
      seasonSlug="major-2026"
      entries={[]}
      total={0}
      page={1}
      pageSize={25}
      totalPages={0}
      normalizedQuery={normalizedQuery}
      hasAnyRecords
      startedCount={8}
      draftCount={7}
    />);

    expect(screen.getByText("没有符合当前筛选条件的报名")).toBeInTheDocument();
    expect(screen.getByText("请调整搜索、状态或资格筛选。")).toBeInTheDocument();
  });

  it("keeps one team status summary and routes member findings to member detail", () => {
    const memberFinding = {
      code: "education_incomplete",
      message: "请完成并通过高校身份认证。",
      waivable: false,
    } as const;

    render(<CompetitionEntryReviewList
      seasonSlug="major-2026"
      entries={[{
        id: "entry-1",
        name: "Team One",
        source: "event_native",
        status: "submitted",
        reviewReason: null,
        perfectTeamId: "perfect-team-1",
        logoUrl: null,
        updatedAt: "2026-09-08T10:00:00.000Z",
        representativeName: "负责人甲",
        minRoster: 5,
        maxRoster: 9,
        starterCount: 5,
        qualificationBlockers: [memberFinding.message, "队伍实力未达到本届要求。"],
        qualificationFindings: [memberFinding, {
          code: "external_strength_gap",
          message: "队伍实力未达到本届要求。",
          waivable: true,
        }],
        activeRestrictionOverrides: [{
          id: "override-1",
          restrictionCode: "external_strength_gap",
          findingSnapshot: {},
          reason: "经赛事负责人复核并批准。",
          grantedBy: "admin@example.com",
          grantedAt: "2026-09-08T11:00:00.000Z",
          snapshotMatches: true,
        }],
        members: [{
          participantId: "participant-1",
          userId: "user-1",
          email: "captain@example.com",
          label: "队员甲",
          status: "confirmed",
          primary: true,
          readiness: {
            ready: false,
            blockers: [memberFinding.message],
            findings: [memberFinding],
            educationApproved: false,
          },
        }],
      }]}
      total={1}
      page={1}
      pageSize={25}
      totalPages={1}
      normalizedQuery={normalizedQuery}
      hasAnyRecords
      startedCount={1}
      draftCount={0}
    />);

    expect(screen.getByText("当前筛选结果")).toBeInTheDocument();
    expect(screen.getByLabelText("Team One报名状态摘要")).toHaveTextContent("名单1/5–9");
    expect(screen.getByLabelText("Team One报名状态摘要")).toHaveTextContent("资格待处理");
    expect(screen.getByText(/负责人：负责人甲/)).toBeInTheDocument();
    expect(screen.getByText(/完美战队 ID（可选）：perfect-team-1/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资格问题 / 例外" })).toBeInTheDocument();
    expect(screen.getByText("队伍实力未达到本届要求。", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("经赛事负责人复核并批准。", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(memberFinding.message, { exact: true })).toHaveLength(1);
    expect(screen.queryByText("身份、学籍与竞技档案已就绪")).not.toBeInTheDocument();
  });
});
