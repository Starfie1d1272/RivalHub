import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db/client", () => ({ db: {} }));
import type { DB } from "@/db/client";
import { reconcileMissingStatisticsProjections } from "@/lib/stats/projection-backfill";

afterEach(() => vi.restoreAllMocks());

// Query/locking is owned by existing real PostgreSQL suites. Inject failures at
// the transaction boundary to protect diagnostic classification and partial progress.
describe("projection repair failure diagnostics", () => {
  it("keeps the original safe SQLSTATE when candidate selection fails", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const transaction = vi.fn().mockRejectedValue(new Error("Failed query: select private", {
      cause: { code: "57014", detail: "secret-person@email.test", query: "raw SQL" },
    }));
    const result = await reconcileMissingStatisticsProjections({ transaction } as unknown as DB);
    expect(result).toMatchObject({ failed: 1, rebuilt: 0, afterMapId: null });
    expect(transaction).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    const event = JSON.parse(String(write.mock.calls[0][0]));
    expect(event).toMatchObject({ event: "stats.projection_repair.failure", errorClass: "database", exception: { code: "57014" }, safeContext: { phase: "candidate_selection" } });
    expect(JSON.stringify(event)).not.toMatch(/select private|secret-person|raw SQL/);
  });

  it("retains prior committed transitions and the cause of a later rebuild failure", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const transaction = vi.fn()
      .mockResolvedValueOnce("private-map-1").mockResolvedValueOnce("rebuilt")
      .mockResolvedValueOnce("private-map-2").mockRejectedValueOnce(new Error("network unavailable", { cause: Object.assign(new Error("reset token=private"), { code: "ECONNRESET" }) }))
      .mockResolvedValueOnce(null);
    const result = await reconcileMissingStatisticsProjections({ transaction } as unknown as DB);
    expect(result).toMatchObject({ failed: 1, rebuilt: 1, scanned: 2, wrapped: true });
    expect(write).toHaveBeenCalledOnce();
    const event = JSON.parse(String(write.mock.calls[0][0]));
    expect(event).toMatchObject({ event: "stats.projection_repair.failure", exception: { cause: { code: "ECONNRESET" } }, safeContext: { phase: "rebuild" } });
    expect(JSON.stringify(event)).not.toMatch(/token=private|private-map/);
  });
});
