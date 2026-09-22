/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EducationReviewWorkspace } from "@/components/admin/EducationReviewWorkspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/education-verifications",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/education-verifications", () => ({ reviewEducationVerification: vi.fn() }));

describe("EducationReviewWorkspace overview", () => {
  beforeEach(() => vi.stubGlobal("React", React));

  it("states the user coverage denominator and presents non-exclusive identity distributions", () => {
    render(<EducationReviewWorkspace emptyState="no-pending" queue={{
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
      institutionOptions: [{ id: "11111111-1111-4111-8111-111111111111", name: "南京大学", userCount: 7 }],
      overview: {
        activeUserCount: 20,
        approvedUserCount: 8,
        institutionDistribution: [
          { id: "11111111-1111-4111-8111-111111111111", name: "南京大学", identityCount: 7 },
          { id: "22222222-2222-4222-8222-222222222222", name: "东南大学", identityCount: 2 },
        ],
        academicDistribution: { enrolled: 6, graduated: 3 },
      },
      normalizedQuery: { status: "pending", academic: "all", sort: "oldest", page: 1, pageSize: 25 },
      hasAnyRecords: true,
    }} />);

    expect(screen.getByText("已认证用户")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText(/同一用户可拥有多个学校身份/)).toBeInTheDocument();
    expect(screen.getByText("南京大学 · 7")).toBeInTheDocument();
    expect(screen.getByText("在读 · 6")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "南京大学（7 人）" })).toBeInTheDocument();
  });
});
