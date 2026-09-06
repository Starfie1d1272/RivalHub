/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMatchOverviewData } from "@/lib/admin/matches/types";

const { loadOverviewMock, matchRowMock } = vi.hoisted(() => ({
  loadOverviewMock: vi.fn(),
  matchRowMock: vi.fn((props: { teamAName: string; teamBName: string }) => <div>{props.teamAName} vs {props.teamBName}</div>),
}));

vi.mock("@/lib/admin/matches/overview", () => ({ loadAdminMatchOverview: loadOverviewMock }));
vi.mock("@/components/matches/AdminMatchRow", () => ({ AdminMatchRow: matchRowMock }));
vi.mock("@/components/matches/AdminMatchFilter", () => ({ AdminMatchFilter: () => null }));
vi.mock("@/components/matches/CreateMatchForm", () => ({ CreateMatchForm: () => null }));
vi.mock("@/components/matches/GeneratePlayoffCard", () => ({ GeneratePlayoffCard: () => null }));
vi.mock("@/components/matches/GenerateScheduleCard", () => ({ GenerateScheduleCard: () => null }));
vi.mock("@/components/matches/BatchDeadlineCard", () => ({ BatchDeadlineCard: () => null }));
vi.mock("@/components/matches/SyncBracketButton", () => ({ SyncBracketButton: () => null }));
vi.mock("@/components/admin/MajorSwissRuntimeManagement", () => ({ MajorSwissRuntimeManagement: () => null }));
vi.mock("@/components/admin/MajorPlayoffRuntimeManagement", () => ({ MajorPlayoffRuntimeManagement: () => null }));
vi.mock("@/components/matches/StandingsTable", () => ({ StandingsTable: () => null }));
vi.mock("@/components/rivalhub", () => ({
  PageHeader: ({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) => <header><h1>{title}</h1>{description}<div>{actions}</div></header>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Section: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

import AdminMatchesPage from "@/app/admin/[seasonSlug]/matches/page";

function overviewData(): AdminMatchOverviewData {
  const stage = { key: "swiss", name: "Swiss", type: "swiss" as const, teamCount: 2, advanceTiers: [] };
  const match = {
    id: "match-1",
    seasonId: "season-1",
    entryAId: "entry-a",
    entryBId: "entry-b",
    stage: "swiss",
    round: 1,
    format: "bo1" as const,
    entryRound: null,
    scoreA: null,
    scoreB: null,
    status: "scheduled" as const,
    isForfeit: false,
    bracketNodeId: null,
    ownership: "major_stage" as const,
    majorStageRunId: "run-1",
    scheduledAt: null,
    completionDeadline: null,
    completedAt: null,
    createdAt: new Date("2026-09-05T00:00:00Z"),
  };
  return {
    season: { id: "season-1", slug: "major", name: "Major", status: "playing" },
    teams: [{ id: "entry-a", name: "Alpha" }, { id: "entry-b", name: "Beta" }],
    stagePlan: [stage],
    matches: [match],
    stageViews: [{ stage, matches: [match] }],
    commentaryEffectiveness: [],
    unconfiguredMatches: [],
    standingsByStage: new Map(),
    qualifierStandings: [],
    qualifierStage: null,
    playoffStage: null,
    batchDeadlineGroups: [],
    canGenerate: false,
    canGeneratePlayoff: false,
    hasLegacyAdjacentPlayoff: false,
    hasSwissStage: true,
    defaultStageKey: "swiss",
    swissRuntime: null,
    playoffRuntime: null,
  };
}

describe("AdminMatchesPage overview boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("passes only summary data to the list row and leaves detail for the workbench", async () => {
    loadOverviewMock.mockResolvedValue(overviewData());

    const html = renderToStaticMarkup(await AdminMatchesPage({
      params: Promise.resolve({ seasonSlug: "major" }),
      searchParams: Promise.resolve({}),
    }));

    expect(loadOverviewMock).toHaveBeenCalledWith({ seasonSlug: "major" });
    expect(html).toContain("Alpha vs Beta");
    const rowProps = matchRowMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(rowProps).toMatchObject({ teamAName: "Alpha", teamBName: "Beta", seasonSlug: "major" });
    expect(rowProps).not.toHaveProperty("teamARoster");
    expect(rowProps).not.toHaveProperty("finishedMaps");
    expect(rowProps).not.toHaveProperty("postMatch");
  });

  it("keeps the season-level commentary effectiveness aggregate on the overview", async () => {
    const data = overviewData();
    data.commentaryEffectiveness = [{
      admin: { userId: "admin-1", name: "解说甲", hasLiveStream: true },
      matches: [data.matches[0]!],
    }];
    loadOverviewMock.mockResolvedValue(data);

    const html = renderToStaticMarkup(await AdminMatchesPage({
      params: Promise.resolve({ seasonSlug: "major" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("解说有效场次统计");
    expect(html).toContain("解说甲");
    expect(html).toContain("1 场");
  });
});
