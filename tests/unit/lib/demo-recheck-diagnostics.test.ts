import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db/client", () => ({ db: mocks }));
import { revalidateSeasonNeedsAttentionImports } from "@/lib/demo-integration/revalidation";

afterEach(() => vi.restoreAllMocks());

// Actual query/locking and promotion are owned by demo integration PostgreSQL
// tests. This protects the partial-batch response and original failure event.
describe("related Demo recheck diagnostics", () => {
  it("keeps successful items successful and captures the failed item's cause safely", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: async () => [
      { id: "private-import-1", matchId: "match-1", matchMapId: "map-1", semanticProfile: "dak-stable/3", status: "needs_attention" },
      { id: "private-import-2", matchId: "match-2", matchMapId: "map-2", semanticProfile: "dak-stable/3", status: "needs_attention" },
    ] }) }) });
    mocks.transaction.mockResolvedValueOnce({ status: "confirmed", importId: "private-import-1", issues: [] })
      .mockRejectedValueOnce(new Error("Failed query: select private", { cause: { code: "40001", detail: "raw personal data" } }));
    const summary = await revalidateSeasonNeedsAttentionImports({ seasonId: "private-season", actorId: "private-actor" });
    expect(summary)
      .toEqual({ attempted: 2, confirmed: 1, remaining: 0, failed: 1, affectedMatchIds: ["match-1"], requestId: expect.any(String) });
    expect(write).toHaveBeenCalledOnce();
    const event = JSON.parse(String(write.mock.calls[0][0]));
    expect(event.requestId).toBe(summary.requestId);
    expect(event).toMatchObject({ retryable: true, event: "demo.recheck.failure", errorClass: "database", exception: { code: "40001" }, safeContext: { phase: "recheck" } });
    expect(JSON.stringify(event)).not.toMatch(/select private|raw personal|private-import|private-season|private-actor/);
  });
});
