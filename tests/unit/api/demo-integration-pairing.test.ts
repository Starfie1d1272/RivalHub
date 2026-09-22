import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, updateMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select: selectMock, update: updateMock } }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: vi.fn() }));

import { deriveDakAccessTokenForTest, pollDakPairing } from "@/lib/demo-integration/pairing";

const pairingId = "10000000-0000-4000-8000-000000000001";
const pollToken = "poll-token-for-retry";

describe("DAK pairing token delivery", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "local-test-session-secret-that-is-long-enough";
    vi.clearAllMocks();
  });

  it("returns the same authorized credential again when the first response was lost", async () => {
    const intent = {
      id: pairingId,
      pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
      status: "authorized" as const,
      expiresAt: new Date(Date.now() + 60_000),
      deliveredAt: null,
    };
    const pairing = { id: "20000000-0000-4000-8000-000000000001", pairingIntentId: pairingId, status: "active" as const };
    let selectCount = 0;
    selectMock.mockImplementation(() => ({
      from: () => ({
        where: async () => {
          selectCount += 1;
          return selectCount % 2 === 1 ? [intent] : [pairing];
        },
      }),
    }));
    updateMock.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          Object.assign(intent, values);
          return [];
        },
      }),
    }));

    const first = await pollDakPairing(pairingId, pollToken);
    const retry = await pollDakPairing(pairingId, pollToken);

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      status: "authorized",
      accessToken: deriveDakAccessTokenForTest(pairingId, pollToken),
    });
    expect(first).not.toMatchObject({ accessToken: "" });
    expect(updateMock).toHaveBeenCalledOnce();
  });
});
