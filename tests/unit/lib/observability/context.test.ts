import { describe, expect, it } from "vitest";
import { createRequestContext, normalizeRequestId, normalizeRoute } from "@/lib/observability/context";

describe("request observability context", () => {
  it("prefers a safe request id and strips query strings from the route", () => {
    const context = createRequestContext(new Request("https://rivalhub.example.com/admin?token_hash=private", {
      headers: { "x-request-id": "req-424" },
    }), "/admin/[season]/registrations");
    expect(context).toEqual({ requestId: "req-424", route: "/admin/[season]/registrations" });
  });

  it("falls back to a generated request id without accepting arbitrary headers", () => {
    const context = createRequestContext(new Request("https://rivalhub.example.com/register?email=private"), undefined);
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.route).toBe("/register");
    expect(normalizeRequestId("bad id")).toBeUndefined();
    expect(normalizeRoute("/x?token=private")).toBe("/x");
  });
});
