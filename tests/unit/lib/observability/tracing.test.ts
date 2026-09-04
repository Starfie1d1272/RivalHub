import { describe, expect, it } from "vitest";
import { sanitizeSpanAttributes, traceOperation } from "@/lib/observability/tracing";

describe("observability tracing", () => {
  it("keeps span names and attributes low-cardinality and URL-safe", () => {
    expect(sanitizeSpanAttributes({
      scope: "provider",
      operation: "lookup?token=private",
      provider: "steam",
      attributes: {
        "rivalhub.workflow": "registration",
        "rivalhub.attempt": 1,
        "user.id": "must-drop",
      },
    })).toEqual({
      "rivalhub.scope": "provider",
      "rivalhub.operation": "lookup",
      "rivalhub.provider": "steam",
      "rivalhub.workflow": "registration",
      "rivalhub.attempt": 1,
    });
  });

  it("returns successful work and rethrows failed work for the action owner", async () => {
    await expect(traceOperation("test.success", {}, async () => "ok")).resolves.toBe("ok");
    await expect(traceOperation("test.failure", {}, async () => {
      throw new Error("expected failure");
    })).rejects.toThrow("expected failure");
  });
});
