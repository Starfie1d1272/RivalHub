import { beforeEach, expect, it, vi } from "vitest";
import TelemetryPage from "@/app/admin/telemetry/page";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";
const mocks = vi.hoisted(() => ({ access: vi.fn(), summary: vi.fn(), analysis: vi.fn() }));
vi.mock("@/lib/auth/admin-access", () => ({ resolveAdminPageAccess: mocks.access }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/admin/product-experience/read", () => ({ loadTelemetryEventNames: async () => ({ rows: [], truncated: false }) }));
vi.mock("@/lib/telemetry/dashboard", () => ({ getLongWindowSummary: mocks.summary, getTelemetryAnalysis: mocks.analysis }));
vi.mock("@/components/telemetry/TelemetryDashboard", () => ({ default: () => null }));
vi.mock("@/components/telemetry/TelemetryLongWindowDashboard", () => ({ TelemetryLongWindowDashboard: () => null }));
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ id: "fixture" }); mocks.summary.mockResolvedValue({ status: "ready", data: {} }); mocks.analysis.mockResolvedValue({ status: "ready", data: {} }); });
it("uses the 24-hour UI default while explicit seven days stays on the summary", async () => {
  await TelemetryPage({ searchParams: Promise.resolve({}) });
  expect(mocks.analysis).toHaveBeenCalledWith({ ...analysisDefaults, hours: "24" });
  mocks.analysis.mockClear();
  await TelemetryPage({ searchParams: Promise.resolve({ hours: "168" }) });
  expect(mocks.summary).toHaveBeenCalledWith(analysisDefaults);
  expect(mocks.analysis).not.toHaveBeenCalled();
});
it("keeps custom time and unsupported filters in the summary request", async () => {
  const params = { hours: "6", from: "2026-10-20T00:00:00Z", to: "2026-10-25T00:00:00Z", browser: "safari", role: "super_admin" };
  await TelemetryPage({ searchParams: Promise.resolve(params) });
  expect(mocks.summary).toHaveBeenCalledWith({ ...analysisDefaults, ...params });
  expect(mocks.analysis).not.toHaveBeenCalled();
});
it("retains an explicit bounded diagnostic read and the short-window reader", async () => {
  await TelemetryPage({ searchParams: Promise.resolve({ analysisMode: "bounded", hours: "168", browser: "safari" }) });
  expect(mocks.analysis).toHaveBeenLastCalledWith({ ...analysisDefaults, browser: "safari" });
  await TelemetryPage({ searchParams: Promise.resolve({ hours: "6" }) });
  expect(mocks.analysis).toHaveBeenLastCalledWith({ ...analysisDefaults, hours: "6" });
  expect(mocks.summary).not.toHaveBeenCalled();
});
it("does not read telemetry when the administrator access boundary denies access", async () => {
  mocks.access.mockResolvedValue(null);
  await TelemetryPage({ searchParams: Promise.resolve({}) });
  expect(mocks.summary).not.toHaveBeenCalled();
  expect(mocks.analysis).not.toHaveBeenCalled();
});
