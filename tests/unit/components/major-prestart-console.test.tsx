import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";

vi.mock("@/components/admin/MajorPrestartManagement", () => ({ MajorLiveRanking: () => null, MajorPrestartManagement: () => null }));
vi.mock("@/components/admin/MajorCompetitionFlow", () => ({ MajorCompetitionFlow: () => null }));
vi.mock("@/components/admin/MajorTournamentSeedsManagement", () => ({ MajorTournamentSeedsManagement: () => <div>种子排序工作区</div> }));
vi.mock("@/components/admin/MajorStartManagement", () => ({ MajorStartManagement: () => null }));
vi.mock("@/components/admin/MajorPrestartScheduleEditor", () => ({ MajorPrestartScheduleEditor: () => null }));
vi.mock("@/components/admin/MajorPrestartRollbackControl", () => ({ MajorPrestartRollbackControl: () => null }));

it("keeps the seed summary and workspace without repeating readiness blocker details", () => {
  const props = {
    seasonName: "Major", started: false,
    readiness: { canStart: false, checks: [{ blockers: ["赛事种子 1 尚未分配"] }] },
    management: { qualification: { run: null }, registrationClosed: true, approvedCandidateCount: 24, pendingReviewCount: 0, entrantCapacity: 24, entrants: [], entrantsLocked: true, initialPreliminaryOrderEntryIds: [], seasonSlug: "major" },
    seedManagement: { seeds: [], seedsConfirmed: false, entrantCapacity: 24, entrants: [] },
  } as unknown as Parameters<typeof MajorPrestartConsole>[0];
  render(<MajorPrestartConsole {...props} />);
  expect(screen.getByText("0/24 个种子已保存")).toBeInTheDocument();
  expect(screen.getByText("种子排序工作区")).toBeInTheDocument();
  expect(screen.queryByText(/当前阻塞|赛事种子 1 尚未分配/)).not.toBeInTheDocument();
});
