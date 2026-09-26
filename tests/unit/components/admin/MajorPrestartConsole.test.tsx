/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import type { MajorPrestartManagementData } from "@/components/admin/MajorPrestartManagement";
import type { MajorTournamentSeedsManagementData } from "@/components/admin/MajorTournamentSeedsManagement";
import type { MajorPrestartReadiness } from "@/lib/major/prestart";

Object.assign(globalThis, { React });

vi.mock("@/components/admin/MajorPrestartManagement", () => ({ MajorPrestartManagement: () => null }));
vi.mock("@/components/admin/MajorCompetitionFlow", () => ({ MajorCompetitionFlow: () => null }));
vi.mock("@/components/admin/MajorTournamentSeedsManagement", () => ({ MajorTournamentSeedsManagement: () => null }));
vi.mock("@/components/admin/MajorStartManagement", () => ({ MajorStartManagement: () => null }));

describe("MajorPrestartConsole", () => {
  it("leaves the complete Stage 1 preview to the seed surface", () => {
    const readiness: MajorPrestartReadiness = {
      canStart: true,
      blockers: [],
      checks: [{ key: "rules", label: "标准 Major 规则", state: "ready", blockers: [] }],
      openingPlan: null,
    };
    const management: MajorPrestartManagementData = {
      seasonId: "season-1",
      seasonSlug: "major",
      seasonStatus: "registration",
      managedProfileId: "major-32",
      registrationClosesAt: null,
      registrationClosed: false,
      entrantCapacity: 32,
      entrantsLocked: false,
      approvedCandidateCount: 0,
      pendingReviewCount: 0,
      initialPreliminaryOrderEntryIds: [],
      strengthPreview: { status: "ready", platform: "perfect_world", conversionPolicyId: null, conversionPolicyVersion: null, blockers: [], teams: [] },
      approvedCandidates: [],
      entrants: [],
      qualification: { run: null },
    };

    const html = renderToStaticMarkup(<MajorPrestartConsole
      seasonName="NJU Major 2026"
      readiness={readiness}
      management={management}
      seedManagement={{} as MajorTournamentSeedsManagementData}
      started={false}
    />);

    expect(html).not.toContain("STAGE1 首轮预览");
  });
});
