import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/server", () => ({ captureException }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

import { readOptionalPublicStats } from "./availability";

describe("optional public statistics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("isolates a dependency outage and records it without executing a fallback query", async () => {
    const read = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) }));

    expect(await readOptionalPublicStats("player_career", read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith("public_stats.unavailable", expect.any(Error), { scope: "stats", operation: "player_career" });
  });

  it("does not hide invalid data or programming defects", async () => {
    const error = new Error("Stats projection target mismatch");
    await expect(readOptionalPublicStats("team_career", async () => { throw error; })).rejects.toBe(error);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
