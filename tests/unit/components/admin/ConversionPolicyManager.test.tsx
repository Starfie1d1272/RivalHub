/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionPolicyManager } from "@/components/admin/ConversionPolicyManager";
import { FIVE_TO_PERFECT_2026_09 } from "@/lib/competitive/conversion-policy";
import type { ConversionPolicyAdminRow } from "@/lib/competitive/conversion-policy-admin";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/conversion-policies", () => ({
  approveConversionPolicyAction: vi.fn(),
  createConversionPolicyDraftAction: vi.fn(),
  retireConversionPolicyAction: vi.fn(),
  setCurrentConversionPolicyAction: vi.fn(),
  updateConversionPolicyDraftAction: vi.fn(),
}));

function policy(overrides: Partial<ConversionPolicyAdminRow> = {}): ConversionPolicyAdminRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sourcePlatform: "fivee",
    targetPlatform: "perfect_world",
    version: "2026.09",
    status: "approved",
    mapping: structuredClone(FIVE_TO_PERFECT_2026_09),
    isCurrent: true,
    sourceNote: "赛事委员会来源说明",
    rationale: "跨平台比较理由",
    changeSummary: "首个正式版本",
    internalNote: "仅管理员备注",
    approvedAt: new Date("2026-09-01T00:00:00Z"),
    approvedBy: null,
    approvedByLabel: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    eventReferences: [],
    ...overrides,
  };
}

describe("ConversionPolicyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists policy provenance without expanding the mapping", () => {
    render(<ConversionPolicyManager initialPolicies={[policy()]} />);

    expect(screen.getByText("2026.09")).toBeInTheDocument();
    expect(screen.getByText("已批准")).toBeInTheDocument();
    expect(screen.getByText("5E → Perfect World")).toBeInTheDocument();
    expect(screen.queryByText("赛事委员会来源说明")).not.toBeInTheDocument();
  });

  it("opens a read-only approved detail with event-facing provenance and lifecycle controls", async () => {
    const user = userEvent.setup();
    render(<ConversionPolicyManager initialPolicies={[policy({ isCurrent: false, eventReferences: [{ seasonId: "season-1", seasonName: "NJU Major", seasonSlug: "nju-major", seasonStatus: "registration", policyId: "11111111-1111-4111-8111-111111111111", policyVersion: "2026.09", registrationOpenedAt: null, referenceState: "published_locked" }] })]} />);

    await user.click(screen.getByRole("button", { name: "查看详情" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("赛事委员会来源说明");
    expect(screen.getByRole("dialog")).toHaveTextContent("已发布锁定版本");
    expect(screen.getByRole("dialog")).toHaveTextContent("仅管理员备注");
    expect(screen.getByRole("dialog")).toHaveTextContent("设为当前版本");
    expect(screen.getByRole("dialog")).toHaveTextContent("退役版本");
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("最低星数").every((field) => field.hasAttribute("disabled"))).toBe(true);
    expect(screen.getAllByLabelText("目标段位").every((field) => field.hasAttribute("disabled"))).toBe(true);
  });
});
