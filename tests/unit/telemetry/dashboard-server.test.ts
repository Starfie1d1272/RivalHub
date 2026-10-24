import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { requireSuperAdmin } = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin }));
vi.mock("server-only", () => ({}));
import { getTelemetryDashboard } from "@/lib/telemetry/dashboard";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.restoreAllMocks(); requireSuperAdmin.mockReset(); });
it("requires current super-admin authorization before reading configuration or querying the provider", async () => {
  requireSuperAdmin.mockRejectedValue(new Error("FORBIDDEN"));
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(getTelemetryDashboard({ hours: "24", release: "", route: "" })).rejects.toThrow("FORBIDDEN");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects invalid query filters before contacting the provider", async () => {
  requireSuperAdmin.mockResolvedValue({ userId: "fixture" });
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(getTelemetryDashboard({ hours: "24", release: "", route: "/private/token" })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["http://user:pass@127.0.0.1:7890", "http://127.0.0.1:7890/path", "file:///proxy", "http://127.0.0.1:7890?token=x"])("rejects unsafe proxy configuration %s before network access", async proxy => {
  requireSuperAdmin.mockResolvedValue({ userId: "fixture" });
  vi.stubEnv("PRODUCT_TELEMETRY_ADMIN_KEY", "fixture-query-key".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://worker.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", proxy);
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(await getTelemetryDashboard({ hours: "24", release: "", route: "" })).toEqual({ status: "unconfigured" });
  expect(fetch).not.toHaveBeenCalled();
});
