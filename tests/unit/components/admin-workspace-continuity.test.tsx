import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminMatchOperations } from "@/components/matches/AdminMatchOperations";
import { SeasonWorkspaceOverview } from "@/components/admin/SeasonWorkspaceOverview";
import type { AdminMatchOperationsRow } from "@/lib/admin/matches/operations";
import type { SeasonWorkspaceOverviewData } from "@/lib/admin/season-workspace/types";

const navigation = vi.hoisted(() => ({ query: "stage=play-in&team=alpha", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/major/matches",
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); navigation.query = "stage=play-in&team=alpha"; });

const row: AdminMatchOperationsRow = {
  id: "match-one", stage: "play-in", round: 1, entryAId: "alpha", entryBId: "beta", scheduledAt: null,
  completionDeadline: null, scheduling: { state: "unproposed", pending: null, autoAcceptAt: null }, responseDueAt: null,
  teams: [{ id: "alpha", name: "Alpha", representative: null }, { id: "beta", name: "Beta", representative: null }],
  awaitingEntryIds: ["alpha", "beta"], commentators: [],
  conflicts: [{ userId: "caster", name: "Caster", matchId: "match-two", isTest: false, scheduledAt: new Date("2026-10-20T12:00:00Z") }],
};

// A return is a fresh mount, not the old component's in-memory state. This
// protects the actual conflict-processing task that the first version lost.
it("restores the conflict queue and original row after navigating back", () => {
  const view = render(<AdminMatchOperations rows={[row]} seasonSlug="major" stage="play-in" team="alpha" stageNames={{ "play-in": "PLAY-IN" }} />);
  fireEvent.click(screen.getByRole("button", { name: "同刻撞档 1" }));
  const [url] = navigation.replace.mock.calls[0]!;
  navigation.query = new URL(url, "https://example.test").search.slice(1);
  view.unmount();
  render(<AdminMatchOperations rows={[row]} seasonSlug="major" stage="play-in" team="alpha" stageNames={{ "play-in": "PLAY-IN" }} />);
  expect(screen.getByRole("button", { name: "同刻撞档 1" })).toHaveAttribute("aria-pressed", "true");
  const href = screen.getByRole("link", { name: "进入比赛工作台" }).getAttribute("href")!;
  expect(new URL(href, "https://example.test").searchParams.get("returnTo")).toBe("/admin/major/matches?stage=play-in&team=alpha&ops=conflict#operation-match-one");
  expect(document.getElementById("operation-match-one")).toBeInTheDocument();
});

const data: SeasonWorkspaceOverviewData = {
  season: { id: "event", slug: "custom", name: "Custom", status: "registration", competitionTemplate: "custom", registrationMode: "team", registrationOpenedAt: null, registrationOpensAt: null, registrationClosesAt: null, rosterChangeClosesAt: null, endAt: null },
  summary: { pendingApplications: 0, approvedEntries: 4, formedTeamCount: 4, entrantCount: 0, frozenEntrantCount: 0, matchCount: 0, scheduledMatchesWithoutConfirmedLineups: 0, finalResultPendingConfirmation: false, activeAdjudications: 0 },
  registrationFunnel: null, readiness: null, prestartPhase: null,
  nextAction: { label: "进入开赛筹备", detail: "", href: "/admin/custom/prestart" },
};

it("presents approved team registrations separately from the Major frozen roster fact", () => {
  const view = render(<SeasonWorkspaceOverview data={data} />);
  expect(screen.getByText("已批准参赛队伍")).toBeInTheDocument();
  expect(screen.queryByText("已冻结正赛名单")).not.toBeInTheDocument();
  view.rerender(<SeasonWorkspaceOverview data={{ ...data, season: { ...data.season, competitionTemplate: "major" }, summary: { ...data.summary, entrantCount: 4, frozenEntrantCount: 2 } }} />);
  expect(screen.getByText("已冻结正赛名单")).toBeInTheDocument();
  expect(screen.getByText("2 / 4 队")).toBeInTheDocument();
});
