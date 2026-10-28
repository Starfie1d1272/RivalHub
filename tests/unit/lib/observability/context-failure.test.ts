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

it("isolates overlapping requests across awaits, nested scopes and module graphs", async () => {
  const { withObservabilityContext, getObservabilityContext } = await import("@/lib/observability/context");
  vi.resetModules();
  const other = await import("@/lib/observability/context");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = withObservabilityContext({ requestId: "first", route: "/first" }, async () => {
    await gate;
    expect(other.getObservabilityContext()).toEqual({ requestId: "first", route: "/first" });
    await expect(other.withObservabilityContext({ route: "/nested" }, async () => {
      await Promise.resolve();
      expect(getObservabilityContext()).toEqual({ requestId: "first", route: "/nested" });
      throw new Error("fixture rejection");
    })).rejects.toThrow("fixture rejection");
    expect(getObservabilityContext().route).toBe("/first");
  });
  await other.withObservabilityContext({ requestId: "second" }, async () => {
    await Promise.resolve();
    expect(getObservabilityContext()).toEqual({ requestId: "second" });
    release();
    await first;
    expect(other.getObservabilityContext()).toEqual({ requestId: "second" });
  });
  expect(getObservabilityContext()).toEqual({});
});
