import { beforeEach, expect, it, vi } from "vitest";
const { requireSuperAdmin } = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin }));
vi.mock("server-only", () => ({}));
import { getTelemetryDashboard } from "@/lib/telemetry/dashboard";

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
