import { expect, it, vi } from "vitest";
import { captureException, logEvent } from "@/lib/observability/logger";

it("a context accessor cannot hide the original exception or break direct event logging", () => {
  const context = Object.defineProperty({ provider: "steam" }, "raw", { enumerable: true, get: () => { throw new Error("private context"); } });
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const result = captureException("fixture.failure", Object.assign(new Error("network unavailable"), { code: "ECONNRESET" }), { scope: "fixture", operation: "read", safeContext: context });
    expect(result).toMatchObject({ exception: { code: "ECONNRESET" }, safeContext: { provider: "steam" } });
    expect(() => logEvent({ level: "error", event: "fixture.failure", scope: "fixture", operation: "read", safeContext: context })).not.toThrow();
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(write.mock.calls)).not.toContain("private context");
  } finally { write.mockRestore(); }
});
