import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  stats: vi.fn(),
  match: vi.fn(),
  reliable: vi.fn(),
}));
vi.mock("@/lib/revalidation", () => ({
  revalidatePublicStatsTag: mocks.stats,
  revalidateMatchPaths: mocks.match,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/demo-integration/submit", () => ({ submitRivalHubEvidence: mocks.submit }));
vi.mock("@/lib/demo-integration/pairing", () => ({
  authenticateDakRequest: async () => ({ pairing: { id: "pairing", seasonIds: ["season"] } }),
}));
vi.mock("@/lib/demo-integration/http", () => ({
  integrationJson: (_request: Request, body: unknown) => Response.json(body),
  integrationError: (_request: Request, error: Error) => Response.json({ error: error.message }, { status: 500 }),
  integrationOptions: () => new Response(null, { status: 204 }),
}));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: async () => [{ slug: "season" }] }) }) },
}));
vi.mock("@/lib/mizar/installation", () => ({
  authenticateMizar: async () => ({ id: "installation", competitionId: "season" }),
  revokeMizarInstallation: vi.fn(),
}));
vi.mock("@/lib/mizar/context", () => ({ loadMizarMatchDocument: vi.fn(), loadMizarScheduleWindow: vi.fn() }));
vi.mock("@/lib/mizar/source", () => ({ claimMizarSource: vi.fn(), releaseMizarSource: vi.fn(), sourceClaimSchema: {}, sourceReleaseSchema: {} }));
vi.mock("@/lib/mizar/reliable", () => ({ ingestMizarReliable: mocks.reliable }));
vi.mock("@/lib/mizar/live", () => ({ ingestMizarLive: vi.fn() }));
vi.mock("@/lib/mizar/http", () => ({
  readBoundedMizarJson: (request: Request) => request.json(),
  mizarContextResponse: vi.fn(),
  mizarHttpError: (error: Error) => Response.json({ error: error.message }, { status: 500 }),
}));

import { POST as submitEvidence } from "@/app/api/integrations/dak/evidence/route";
import { POST as ingestReliable } from "@/app/api/mizar/[operation]/route";

describe("machine writes refresh public statistics after commit", () => {
  beforeEach(() => vi.resetAllMocks());

  it("invalidates confirmed DAK submissions, including idempotent confirmations", async () => {
    mocks.submit.mockResolvedValue({ status: "synced", importId: "import" });
    const response = await submitEvidence(new Request("http://localhost/api/integrations/dak/evidence", { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(mocks.stats).toHaveBeenCalledOnce();
    expect(mocks.submit.mock.invocationCallOrder[0]).toBeLessThan(mocks.stats.mock.invocationCallOrder[0]!);
  });

  it("does not invalidate for rejected or unconfirmed submissions", async () => {
    mocks.submit.mockResolvedValue({ status: "needs_attention", importId: "import" });
    await submitEvidence(new Request("http://localhost/api/integrations/dak/evidence", { method: "POST", body: "{}" }));
    expect(mocks.stats).not.toHaveBeenCalled();
    mocks.submit.mockRejectedValue(new Error("not committed"));
    const response = await submitEvidence(new Request("http://localhost/api/integrations/dak/evidence", { method: "POST", body: "{}" }));
    expect(response.status).toBe(500);
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it("uses Route Handler semantics after a Mizar reliable event commits", async () => {
    const matchId = "11111111-1111-4111-8111-111111111111";
    mocks.reliable.mockResolvedValue({ outcome: "canonicalized", duplicate: false });
    const response = await ingestReliable(new Request("http://localhost/api/mizar/reliable", {
      method: "POST",
      headers: { "x-rivalhub-authority": "1" },
      body: JSON.stringify({ event: { matchId }, lineupSteam64: [] }),
    }), { params: Promise.resolve({ operation: "reliable" }) });
    expect(response.status).toBe(200);
    expect(mocks.match).toHaveBeenCalledWith("season", matchId, { mode: "route" });
  });

  it("does not evict all statistics for telemetry or source-health events", async () => {
    mocks.reliable.mockResolvedValue({ outcome: "observed", duplicate: false });
    const response = await ingestReliable(new Request("http://localhost/api/mizar/reliable", {
      method: "POST",
      headers: { "x-rivalhub-authority": "1" },
      body: JSON.stringify({ event: { matchId: "11111111-1111-4111-8111-111111111111" } }),
    }), { params: Promise.resolve({ operation: "reliable" }) });
    expect(response.status).toBe(200);
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.stats).not.toHaveBeenCalled();
  });
});
