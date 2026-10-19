import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ award: vi.fn(), season: vi.fn(), requireSeasonAdmin: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { communityAwards: { findFirst: mocks.award }, seasons: { findFirst: mocks.season } }, transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: mocks.requireSeasonAdmin, requireAuth: vi.fn(), auditActorId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/community-awards/service", () => ({ configureCommunityAwardInTx: vi.fn(), verifyCommunityAwardEvidenceInTx: vi.fn() }));
import { configureCommunityAward, verifyCommunityAwardEvidence } from "@/actions/community-awards";
import { AppError, ErrorCode } from "@/lib/errors";

const awardId = "11111111-1111-4111-8111-111111111111", seasonId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.clearAllMocks(); mocks.award.mockResolvedValue({ id: awardId, seasonId }); mocks.season.mockResolvedValue({ id: seasonId, slug: "isolated" }); mocks.requireSeasonAdmin.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "无本届管理权限")); });

describe("community award new administrator boundaries", () => {
  it("checks this award's season before changing its settlement policy", async () => {
    const result = await configureCommunityAward({ awardId, recipientPolicy: "single", recipientLimit: 1, settlementPolicy: "event_verified", settlementStageKey: null, reason: "规则确认", expectedVersion: 0 });
    expect(result).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
    expect(mocks.requireSeasonAdmin).toHaveBeenCalledWith(seasonId);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("checks the award's season before verifying evidence and rejects an absent version", async () => {
    const input = { awardId, evidenceId: awardId, status: "eligible", note: "核验通过" };
    expect(await verifyCommunityAwardEvidence(input)).toMatchObject({ success: false });
    expect(mocks.requireSeasonAdmin).not.toHaveBeenCalled();
    expect(await verifyCommunityAwardEvidence({ ...input, expectedVersion: 0 })).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
    expect(mocks.requireSeasonAdmin).toHaveBeenCalledWith(seasonId);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
