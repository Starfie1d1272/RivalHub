import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@/lib/observability/server", () => mocks);
import { onRequestError } from "@/instrumentation";
import { sanitizeSafeContext } from "@/lib/observability/redact";

describe("Next error to request correlation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("attaches the UI digest and normalized request ID to the existing server event", async () => {
    const error = Object.assign(new Error("private internal cause"), { digest: "1234567890" });
    await onRequestError(error, { path: "/stats?private=1", method: "GET", headers: { "x-vercel-id": "hkg1::existing-request" } }, { routerKind: "App Router", revalidateReason: undefined, routePath: "/stats", routeType: "render", renderSource: "react-server-components" });
    expect(mocks.captureException).toHaveBeenCalledOnce();
    const [event, cause, options] = mocks.captureException.mock.calls[0];
    expect(event).toBe("next.request.unhandled_error");
    expect(cause).toBe(error);
    expect(options).toMatchObject({ requestId: "hkg1::existing-request", route: "/stats", operation: "render" });
    expect(sanitizeSafeContext(options.safeContext)).toMatchObject({ errorDigest: "1234567890", routeType: "render" });
    expect(JSON.stringify(options)).not.toContain("private");
  });
  it("retains failure capture without inventing a UI identifier for an invalid digest", async () => {
    const error = Object.assign(new Error("private"), { digest: "secret-value" });
    await onRequestError(error, { path: "/stats", method: "GET", headers: { "x-request-id": "existing-request" } }, { routerKind: "App Router", revalidateReason: undefined, routePath: "/stats", routeType: "render" });
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(sanitizeSafeContext(mocks.captureException.mock.calls[0][2].safeContext)).not.toHaveProperty("errorDigest");
  });
});
