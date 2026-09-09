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
        primaryBlockers: ["还差 3 名成员确认", "还差 1 名预定主力", "队伍图标尚未上传"],
      }],
      summary: { total: 7, draft: 7, submitted: 0, approved: 0, changesRequested: 0, waitlisted: 0, rejected: 0, withdrawn: 0 },
    }} />);

    expect(screen.getByText("已有 7 支队伍正在填写报名")).toBeInTheDocument();
    expect(screen.getByText("Dry Pull & Pray")).toBeInTheDocument();
    expect(screen.getByText("6/5–9")).toBeInTheDocument();
    expect(screen.getByText("3/6")).toBeInTheDocument();
    expect(screen.getByText(/还差 3 名成员确认；还差 1 名预定主力/)).toBeInTheDocument();
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
});
