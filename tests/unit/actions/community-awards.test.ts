import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const requireAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ requireAuth: requireAuthMock, requireSeasonAdmin: vi.fn(), auditActorId: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { communityAwards: { findFirst: vi.fn() }, seasons: { findFirst: vi.fn() } }, transaction: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addCommunityAwardEvidence } from "@/actions/community-awards";

describe("community award evidence URL validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-http(s) evidence video URLs before authentication", async () => {
    const result = await addCommunityAwardEvidence({
      awardId: "11111111-1111-4111-8111-111111111111",
      explanation: "录像证据",
      videoUrl: "javascript:alert(1)",
    });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(requireAuthMock).not.toHaveBeenCalled();
  });
});
