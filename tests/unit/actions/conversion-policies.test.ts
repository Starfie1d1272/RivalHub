import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const {
  requireSuperAdminMock,
  auditActorIdMock,
  createDraftMock,
  updateDraftMock,
  approveMock,
  setCurrentMock,
  retireMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  auditActorIdMock: vi.fn(),
  createDraftMock: vi.fn(),
  updateDraftMock: vi.fn(),
  approveMock: vi.fn(),
  setCurrentMock: vi.fn(),
  retireMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/competitive/conversion-policy-admin", () => ({
  createConversionPolicyDraft: createDraftMock,
  updateConversionPolicyDraft: updateDraftMock,
  approveConversionPolicy: approveMock,
  setCurrentConversionPolicy: setCurrentMock,
  retireConversionPolicy: retireMock,
}));

import {
  approveConversionPolicyAction,
  createConversionPolicyDraftAction,
  retireConversionPolicyAction,
  setCurrentConversionPolicyAction,
  updateConversionPolicyDraftAction,
} from "@/actions/conversion-policies";

const POLICY_ID = "11111111-1111-4111-8111-111111111111";

describe("conversion policy action permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));
    auditActorIdMock.mockReturnValue("actor-1");
  });

  it.each([
    ["create draft", () => createConversionPolicyDraftAction({ basePolicyId: POLICY_ID, version: "2026.10" }), createDraftMock],
    ["update draft", () => updateConversionPolicyDraftAction({ id: POLICY_ID, mapping: {} }), updateDraftMock],
    ["approve", () => approveConversionPolicyAction({ id: POLICY_ID }), approveMock],
    ["set current", () => setCurrentConversionPolicyAction({ id: POLICY_ID }), setCurrentMock],
    ["retire", () => retireConversionPolicyAction({ id: POLICY_ID }), retireMock],
  ] as const)("rejects %s before touching the command owner", async (_name, invoke, command) => {
    const result = await invoke();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(command).not.toHaveBeenCalled();
    expect(auditActorIdMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
