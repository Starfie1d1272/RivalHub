import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { requireSuperAdmin } = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin }));
vi.mock("server-only", () => ({}));
import {analyzeTelemetry} from "@/lib/telemetry/analysis-model";
import {analysisDefaults} from "@/lib/telemetry/analysis-query";
import { getTelemetryAnalysis } from "@/lib/telemetry/dashboard";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.restoreAllMocks(); requireSuperAdmin.mockReset(); });
it("requires current super-admin authorization before reading configuration or querying the provider", async () => {
  requireSuperAdmin.mockRejectedValue(new Error("FORBIDDEN"));
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(getTelemetryAnalysis({ hours: "24", release: "", route: "" })).rejects.toThrow("FORBIDDEN");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects invalid query filters before contacting the provider", async () => {
  requireSuperAdmin.mockResolvedValue({ userId: "fixture" });
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(getTelemetryAnalysis({ hours: "24", release: "", route: "/private/token" })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["http://user:pass@127.0.0.1:7890", "http://127.0.0.1:7890/path", "file:///proxy", "http://127.0.0.1:7890?token=x"])("rejects unsafe proxy configuration %s before network access", async proxy => {
  requireSuperAdmin.mockResolvedValue({ userId: "fixture" });
  vi.stubEnv("PRODUCT_TELEMETRY_ADMIN_KEY", "fixture-query-key".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://worker.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", proxy);
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(await getTelemetryAnalysis({ hours: "24", release: "", route: "" })).toEqual({ status: "unconfigured" });
  expect(fetch).not.toHaveBeenCalled();
});

it("authorizes the current operator before analysis configuration, transport or cache access", async () => {
  requireSuperAdmin.mockRejectedValue(new Error("FORBIDDEN"));
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(getTelemetryAnalysis({})).rejects.toThrow("FORBIDDEN");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects untrusted analysis dimensions before contacting the receiver", async () => {
  requireSuperAdmin.mockResolvedValue({ userId: "fixture" });
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(
    getTelemetryAnalysis({ session: "private-session" }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it("revoked authorization cannot reuse a cached analysis result",async()=>{
 requireSuperAdmin.mockResolvedValue({userId:"fixture"});
 vi.stubEnv("PRODUCT_TELEMETRY_ADMIN_KEY","fixture-analysis-key".repeat(3));
 vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT","https://worker.invalid/v1/batches");
 const now=Date.now();
 const data=analyzeTelemetry({capturedAt:now,batches:0,bytes:0,oldest:now,events:[],metricIds:[],usage:{usage:[],expiredBatches:0,budget:{batches:5000,bytes:8388608}},truncated:false,validUntil:now+60000},analysisDefaults);
 const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(data)));
 expect((await getTelemetryAnalysis({})).status).toBe("ready");
 requireSuperAdmin.mockRejectedValue(new Error("FORBIDDEN"));
 await expect(getTelemetryAnalysis({})).rejects.toThrow("FORBIDDEN");
 expect(fetch).toHaveBeenCalledTimes(1);
});
